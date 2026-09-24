param(
    [switch]$NoZip,
    [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$standaloneRoot = Join-Path $repositoryRoot "standalone"
$version = [IO.File]::ReadAllText((Join-Path $standaloneRoot "VERSION")).Trim()
if ($version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Invalid Standalone version: $version"
}

# The packaging contract lives with the Standalone app so it can be reviewed and
# tested alongside it. Adding a root-level file to the project means adding it to
# upstream.files in that manifest - this script no longer keeps its own list.
$manifestPath = Join-Path $standaloneRoot "package.manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "Package manifest is missing: $manifestPath"
}
$manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
if ($manifest.schema_version -ne 1) {
    throw "Unsupported package manifest schema_version: $($manifest.schema_version)"
}

foreach ($required in @("backend\routes.py", "standalone\prompt_studio\app.py")) {
    if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot $required))) {
        throw "Required source is missing: $required"
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot ".git")) -or -not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "The Standalone release build requires a Git checkout and git on PATH"
}
$repositoryCommit = (& git -C $repositoryRoot rev-parse HEAD).Trim()
$repositoryDirty = [bool]((& git -C $repositoryRoot status --porcelain) -join "")
if ($repositoryDirty -and -not $AllowDirty) {
    throw "The checkout has local changes. Commit them or pass -AllowDirty for a development build."
}
if ($repositoryDirty) {
    Write-Warning "Building from a dirty checkout because -AllowDirty was specified."
}

$distRoot = Join-Path $repositoryRoot "dist"
$packageName = "Prompt-Studio-Standalone-Windows-v$version"
$target = Join-Path $distRoot $packageName
$zip = Join-Path $distRoot "$packageName.zip"
$resolvedDist = [IO.Path]::GetFullPath($distRoot)
$resolvedTarget = [IO.Path]::GetFullPath($target)
if (-not $resolvedTarget.StartsWith($resolvedDist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to replace a target outside dist: $resolvedTarget"
}

New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $target | Out-Null

function Copy-TrackedTree([string]$Relative, [string]$Destination) {
    $files = @(& git -C $repositoryRoot ls-files -- $Relative)
    if ($LASTEXITCODE -ne 0 -or -not $files) { throw "No tracked source files: $Relative" }
    foreach ($file in $files) {
        $suffix = $file.Substring($Relative.Length).TrimStart("/")
        $output = if ($suffix) { Join-Path $Destination $suffix } else { $Destination }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
        Copy-Item -LiteralPath (Join-Path $repositoryRoot $file) -Destination $output
    }
}

function Copy-RequiredFile([string]$SourceRoot, [string]$Relative, [string]$Destination) {
    $source = Join-Path $SourceRoot $Relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Manifest references a missing file: $Relative"
    }
    $output = Join-Path $Destination (Split-Path -Leaf $Relative)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
    Copy-Item -LiteralPath $source -Destination $output
}

# --- Application files -------------------------------------------------------
foreach ($tree in $manifest.app.trees) {
    Copy-TrackedTree "standalone/$tree" (Join-Path $target $tree)
}
foreach ($file in $manifest.app.files) {
    Copy-RequiredFile $standaloneRoot $file $target
}
if ($manifest.app.data_example) {
    $dataTarget = Join-Path $target "data"
    New-Item -ItemType Directory -Force -Path $dataTarget | Out-Null
    Copy-Item -LiteralPath (Join-Path $standaloneRoot $manifest.app.data_example) -Destination (Join-Path $dataTarget (Split-Path -Leaf $manifest.app.data_example))
}
foreach ($directory in $manifest.app.create_empty_dirs) {
    New-Item -ItemType Directory -Force -Path (Join-Path $target $directory) | Out-Null
}

# --- Vendored upstream -------------------------------------------------------
$upstreamTarget = Join-Path $target $manifest.upstream.destination
New-Item -ItemType Directory -Force -Path $upstreamTarget | Out-Null
# targets.json must sit beside backend/ (backend/targets/__init__.py resolves it at
# the checkout root) and is also a modern-checkout marker in the host's
# validate_upstream(), so a package without it refuses to start.
foreach ($tree in $manifest.upstream.trees) {
    Copy-TrackedTree $tree (Join-Path $upstreamTarget $tree)
}
foreach ($file in $manifest.upstream.files) {
    Copy-RequiredFile $repositoryRoot $file $upstreamTarget
}

# Keep the repository's shared documentation links usable inside the ZIP.
foreach ($rule in $manifest.link_rewrites) {
    $items = switch ($rule.file) {
        "app/README.md" { @(Join-Path $target "README.md") }
        "upstream/README.md" { @(Join-Path $upstreamTarget "README.md") }
        default {
            if ($rule.file -like "upstream/docs/*.md") {
                @(Get-ChildItem -LiteralPath (Join-Path $upstreamTarget "docs") -Filter "*.md" | ForEach-Object { $_.FullName })
            } else {
                throw "Unknown link_rewrites file pattern: $($rule.file)"
            }
        }
    }
    foreach ($path in $items) {
        $content = [IO.File]::ReadAllText($path)
        foreach ($replacement in $rule.replacements) {
            $content = $content.Replace($replacement.from, $replacement.to)
        }
        [IO.File]::WriteAllText($path, $content, [Text.UTF8Encoding]::new($false))
    }
}
$versionSource = [IO.File]::ReadAllText((Join-Path $repositoryRoot "backend\version.py"))
$extensionMatch = [regex]::Match($versionSource, 'VERSION\s*=\s*"([^"]+)"')
$extensionVersion = if ($extensionMatch.Success) { $extensionMatch.Groups[1].Value } else { "unknown" }
$snapshot = @(
    "Prompt Studio core snapshot"
    "repository_commit=$repositoryCommit"
    "dirty=$($repositoryDirty.ToString().ToLowerInvariant())"
    "extension_version=$extensionVersion"
    "standalone_version=$version"
)
[IO.File]::WriteAllLines((Join-Path $upstreamTarget $manifest.upstream.snapshot_file), $snapshot)

# The vendored upstream must satisfy the host's own validate_upstream() contract.
# Mirroring the manifest's required list here turns a shipping mistake into a
# build failure instead of a ZIP that refuses to start.
foreach ($relative in $manifest.upstream.required) {
    $native = $relative.Replace("/", [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath (Join-Path $upstreamTarget $native))) {
        throw "Standalone upstream contract is incomplete, missing: $relative"
    }
}

if ($NoZip) {
    Write-Host "Built: $target"
    exit 0
}
if (Test-Path -LiteralPath $zip) {
    Remove-Item -LiteralPath $zip -Force
}
Compress-Archive -Path (Join-Path $target "*") -DestinationPath $zip -CompressionLevel Optimal
Write-Host "Built: $zip"
