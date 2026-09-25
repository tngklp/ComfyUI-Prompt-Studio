from pathlib import Path

import folder_paths

from .backend.version import VERSION


WEB_DIRECTORY = "./web"

LLM_MODELS_DIRECTORY = Path(folder_paths.models_dir) / "LLM"
LLM_MODELS_DIRECTORY.mkdir(parents=True, exist_ok=True)
folder_paths.add_model_folder_path("LLM", str(LLM_MODELS_DIRECTORY), is_default=True)

# Importing the route module registers the extension endpoints with ComfyUI.
from .backend import routes as _routes  # noqa: E402,F401

# The Anima character catalogue is downloaded rather than shipped, so a first launch
# fetches it. This has to happen off the import path: ComfyUI is starting up, the
# user may be offline, and a 9 MB download must never gate the node registration.
# A detached thread leaves the studio fully usable while it runs, and the picker
# reports the offline state if it fails.
_routes.character_data.start_background_fetch()

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__version__ = VERSION

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY", "__version__"]
