from __future__ import annotations

import base64
import io
import math
import shutil
from fractions import Fraction
from pathlib import Path
from uuid import uuid4

import av
from PIL import Image, ImageOps

from .media import MediaError, _av_metadata, _normalize_frame_count_mode, process_image, process_video, REFERENCE_DURATION_TOLERANCE_SECONDS


def normalize_edit(asset, body):
    source = asset.get("source") or asset
    width, height = int(source["width"]), int(source["height"])
    if not isinstance(body, dict):
        raise MediaError("INVALID_EDIT", "Media edit must be an object.")
    def number(value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise MediaError("INVALID_EDIT", "Edit coordinates and times must be finite numbers.")
        return value
    crop = body.get("crop", {"x": 0, "y": 0, "w": width, "h": height})
    if not isinstance(crop, dict) or not all(key in crop for key in ("x", "y", "w", "h")):
        raise MediaError("INVALID_EDIT", "A complete crop rectangle is required.")
    crop = {key: round(number(crop[key])) for key in ("x", "y", "w", "h")}
    if crop["x"] < 0 or crop["y"] < 0 or crop["w"] < 1 or crop["h"] < 1 or crop["x"]+crop["w"] > width or crop["y"]+crop["h"] > height:
        raise MediaError("INVALID_EDIT", "Crop must remain inside the source media.")
    duration = source.get("duration") or 0
    start, end = number(body.get("start", 0)), number(body.get("end", duration))
    if asset["type"] == "video" and not (0 <= start < end <= duration + .001):
        raise MediaError("INVALID_EDIT", "Trim must remain inside the source video.")
    endpoints = body.get("include_endpoints", asset.get("include_endpoints", True))
    if not isinstance(endpoints, bool):
        raise MediaError("INVALID_SAMPLE_ENDPOINTS", "First & last must be true or false.")
    sample_index = body.get("sample_index", asset.get("sample_index", 0))
    if isinstance(sample_index, bool) or not isinstance(sample_index, int) or sample_index < 0:
        raise MediaError("INVALID_EDIT", "Invalid sample index.")
    return {"crop": crop, "start": start, "end": min(end, duration),
            "frame_count_mode": _normalize_frame_count_mode(body.get("frame_count_mode", asset.get("frame_count_mode", "auto"))),
            "include_endpoints": endpoints, "sample_index": sample_index}


def image_data(image):
    output = io.BytesIO()
    image.save(output, "JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def browser_source(asset):
    """Create a full-source playback/view copy only when the browser needs one."""
    source = Path(asset["_original_path"])
    target = source.parent / ("editor_source.png" if asset["type"] == "image" else "editor_source.mp4")
    if target.exists():
        return target
    temporary = target.with_name(f"view_{uuid4()}{target.suffix}")
    try:
        if asset["type"] == "image":
            with Image.open(source) as opened:
                ImageOps.exif_transpose(opened).convert("RGBA").save(temporary, "PNG")
        elif asset["type"] == "video":
            render_video(source, temporary, normalize_edit(asset, {}))
        else:
            raise MediaError("UNSUPPORTED_MEDIA", "Only Pictures and Videos have editor sources.")
        temporary.replace(target)
        return target
    except Exception as error:
        raise MediaError("MEDIA_DECODE_FAILED", f"Could not prepare browser playback: {error}") from error
    finally:
        temporary.unlink(missing_ok=True)


def video_frame(asset, timestamp, direction=0, crop=None, png=False):
    """Select actual decoded presentation timestamps, including variable-rate sources."""
    duration = (asset.get("source") or asset)["duration"]
    if not isinstance(timestamp, (float, int)) or not math.isfinite(timestamp) or direction not in (-1, 0, 1):
        raise MediaError("INVALID_EDIT", "Invalid frame position.")
    timestamp = min(max(0, timestamp), duration)
    with av.open(asset["_original_path"]) as container:
        stream = container.streams.video[0]
        origin = float((stream.start_time or 0) * stream.time_base)
        container.seek(max(0, int((origin + max(0, timestamp - (2 if direction < 0 else 0))) / stream.time_base)), stream=stream, backward=True)
        previous = selected = None
        for frame in container.decode(stream):
            if frame.time is None:
                continue
            t = float(frame.time) - origin
            selected = frame
            if direction < 0 and t >= timestamp - .00001:
                selected = previous or frame
                break
            if direction == 0 and t > timestamp + .00001:
                selected = previous or frame
                break
            if direction > 0 and t >= timestamp + .00001:
                break
            previous = frame
        if selected is None:
            raise MediaError("MEDIA_DECODE_FAILED", "No decoded frame is available at this position.")
        image = selected.to_image().convert("RGB")
        if crop is not None:
            c = normalize_edit(asset, {"crop": crop})["crop"]
            image = image.crop((c["x"], c["y"], c["x"]+c["w"], c["y"]+c["h"]))
        if png:
            output = io.BytesIO()
            image.save(output, "PNG")
            data = "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")
        else:
            image.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
            data = image_data(image)
        return {"image": data, "timestamp": max(0, float(selected.time)-origin)}


def render_video(source, target, edit):
    """Encode from the immutable source, preserving presentation timing and trimmed audio."""
    import numpy as np
    crop, start, end = edit["crop"], edit["start"], edit["end"]
    with av.open(str(source)) as incoming, av.open(str(target), "w", format="mp4") as outgoing:
        video = incoming.streams.video[0]
        audio = next(iter(incoming.streams.audio), None)
        origin = float((video.start_time or 0) * video.time_base)
        vout = outgoing.add_stream("libx264", rate=video.average_rate or Fraction(24))
        vout.width, vout.height = crop["w"], crop["h"]
        # 4:4:4 supports exact odd-pixel crops without silently changing their dimensions.
        vout.pix_fmt = "yuv420p" if crop["w"] % 2 == crop["h"] % 2 == 0 else "yuv444p"
        vout.time_base = Fraction(1, 90000)
        vout.codec_context.time_base = vout.time_base
        vout.options = {"crf": "18", "preset": "fast"}
        aout = outgoing.add_stream("aac", rate=48000) if audio else None
        if aout:
            aout.layout = audio.codec_context.layout.name
        resampler = av.AudioResampler(format="fltp", layout=aout.layout, rate=48000) if aout else None
        streams = [video, audio] if audio else [video]
        incoming.seek(max(0, int((origin+start) / video.time_base)), stream=video, backward=True)
        last_video_pts = -1
        audio_end_pts = 0
        finished = set()
        def encode_audio(frame):
            nonlocal audio_end_pts
            if frame.time is None:
                return
            t = float(frame.time) - origin
            lo = max(0, math.ceil((start-t)*48000-1e-6))
            hi = min(frame.samples, math.ceil((end-t)*48000-1e-6))
            if hi <= lo:
                return
            data = np.ascontiguousarray(frame.to_ndarray()[:, lo:hi])
            out = av.AudioFrame.from_ndarray(data, format="fltp", layout=aout.layout.name)
            out.sample_rate = 48000
            out.time_base = Fraction(1, 48000)
            out.pts = max(audio_end_pts, round((t-start)*48000)+lo)
            audio_end_pts = out.pts+out.samples
            for packet in aout.encode(out):
                outgoing.mux(packet)
        for packet in incoming.demux(streams):
            if packet.stream.index in finished:
                continue
            for frame in packet.decode():
                if frame.time is not None and float(frame.time)-origin >= end:
                    finished.add(packet.stream.index)
                    break
                if packet.stream.type == "audio":
                    for decoded in resampler.resample(frame):
                        encode_audio(decoded)
                    continue
                if frame.time is None:
                    continue
                t = float(frame.time) - origin
                if t < start-.00001 or t >= end:
                    continue
                image = frame.to_image().crop((crop["x"], crop["y"], crop["x"]+crop["w"], crop["y"]+crop["h"]))
                output = av.VideoFrame.from_image(image)
                output.time_base = vout.time_base
                output.pts = max(last_video_pts+1, round((t-start)*90000))
                last_video_pts = output.pts
                for encoded in vout.encode(output):
                    outgoing.mux(encoded)
            if len(finished) == len(streams):
                break
        if last_video_pts < 0:
            raise MediaError("MEDIA_DECODE_FAILED", "The selected interval contains no video frames.")
        if resampler:
            for frame in resampler.resample(None):
                encode_audio(frame)
        for stream in [vout, aout] if aout else [vout]:
            for packet in stream.encode(None):
                outgoing.mux(packet)


def extract_audio(source, target, start, end):
    """Export the selected video interval as PCM audio, preserving silence and timing."""
    import wave

    if not 2 <= end - start <= 15:
        raise MediaError("UNSUPPORTED_DURATION", "Select 2-15 seconds to extract an audio reference.")
    with av.open(str(source)) as incoming:
        audio = next(iter(incoming.streams.audio), None)
        if audio is None:
            raise MediaError("NO_AUDIO", "This video has no audio track.")
        video = incoming.streams.video[0]
        origin = float((video.start_time or 0) * video.time_base)
        channels = len(audio.codec_context.layout.channels)
        rate, written, decoded_any = 48000, 0, False
        total = round((end - start) * rate)
        incoming.seek(max(0, int((origin + start) / audio.time_base)), stream=audio, backward=True)
        resampler = av.AudioResampler(format="s16", layout=audio.codec_context.layout, rate=rate)
        with wave.open(str(target), "wb") as output:
            output.setparams((channels, 2, rate, 0, "NONE", "not compressed"))

            def write(frame):
                nonlocal written, decoded_any
                if frame.time is None:
                    return
                offset = round((float(frame.time) - origin - start) * rate)
                lo, hi = max(0, -offset, written - offset), min(frame.samples, total - offset)
                if hi <= lo:
                    return
                if offset + lo > written:
                    output.writeframesraw(bytes((offset + lo - written) * channels * 2))
                output.writeframesraw(frame.to_ndarray()[:, lo * channels:hi * channels].tobytes())
                written, decoded_any = offset + hi, True

            for frame in incoming.decode(audio):
                if frame.time is not None and float(frame.time) - origin >= end:
                    break
                for converted in resampler.resample(frame):
                    write(converted)
            for converted in resampler.resample(None):
                write(converted)
            if not decoded_any:
                raise MediaError("NO_AUDIO", "The selected interval contains no decodable audio.")
            if written < total:
                output.writeframesraw(bytes((total - written) * channels * 2))


def prepare_edit(asset, body, action):
    if asset["type"] not in ("image", "video"):
        raise MediaError("UNSUPPORTED_MEDIA", "Only Pictures and Videos can be edited.")
    if body.get("revision") != asset.get("content_revision", 0):
        raise MediaError("MEDIA_CHANGED", "Media changed. Reopen the editor before saving.")
    edit = normalize_edit(asset, body)
    root = Path(asset["_original_path"]).parent
    directory = root / f"edit_{uuid4()}"
    directory.mkdir()
    try:
        source = Path(asset["_original_path"])
        target = directory / ("edited.png" if asset["type"] == "image" else "edited.mp4")
        if action == "audio":
            if asset["type"] != "video":
                raise MediaError("UNSUPPORTED_MEDIA", "Extract audio requires a video.")
            target = directory / "audio.wav"
            extract_audio(source, target, edit["start"], edit["end"])
            return {"directory": directory, "target": target}
        if asset["type"] == "image":
            with Image.open(source) as opened:
                image = ImageOps.exif_transpose(opened).convert("RGBA")
                c = edit["crop"]
                image.crop((c["x"], c["y"], c["x"]+c["w"], c["y"]+c["h"])).save(target, "PNG")
            processed = process_image(target, directory)
        else:
            if action != "preview":
                render_video(source, target, edit)
            processed = process_video(source, directory, **edit)
            if action != "preview":
                encoded = _av_metadata(target)
                processed.update({key: encoded[key] for key in ("duration", "width", "height", "has_audio", "fps")})
        if action == "preview":
            with Image.open(processed.get("_contact_sheet_path") or processed["_prepared_path"]) as image:
                return {"image": image_data(image), "width": processed["width"], "height": processed["height"],
                        "duration": processed.get("duration"), "frames": [{"timestamp": f["timestamp"]} for f in processed.get("_frames", [])]}
        return {"directory": directory, "target": target, "edit": edit, "processed": processed,
                "revision": asset.get("content_revision", 0), "source": asset["_original_path"]}
    except MediaError:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    except Exception as error:
        shutil.rmtree(directory, ignore_errors=True)
        raise MediaError("MEDIA_EDIT_FAILED", f"Could not prepare the media edit: {error}") from error
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    finally:
        if action == "preview":
            shutil.rmtree(directory, ignore_errors=True)


def commit_edit(store, session_id, asset_id, prepared):
    asset = store.get(session_id, asset_id)
    if asset["_original_path"] != prepared["source"] or asset.get("content_revision", 0) != prepared["revision"]:
        raise MediaError("MEDIA_CHANGED", "Media changed while the edit was being prepared.")
    old_paths = [asset.get("_edited_path"), asset.get("_preview_path"), asset.get("_prepared_path"), asset.get("_contact_sheet_path")]
    old_paths += [f["path"] for f in asset.get("_frames", [])]
    was_staged = asset.get("status") == "needs_edit"
    asset.update(prepared["processed"])
    non_reference = asset["type"] == "video" and asset["mode"] == "Reference" and not (2 <= (asset.get("duration") or 0) <= REFERENCE_DURATION_TOLERANCE_SECONDS)
    asset.update(edit=prepared["edit"], status="needs_edit" if non_reference else "ready", content_revision=prepared["revision"]+1,
                 _edited_path=str(prepared["target"]), size=prepared["target"].stat().st_size,
                 mime_type="image/png" if asset["type"] == "image" else "video/mp4")
    if was_staged and not non_reference and asset["mode"] == "Reference":
        # Newly eligible media joins the end of the active reference order.
        assets = store.sessions[session_id]
        assets.remove(asset)
        assets.append(asset)
    store._renumber(store.sessions[session_id], asset["mode"])
    source_dir = Path(asset["_original_path"]).parent
    for directory in {Path(p).parent for p in old_paths if p}:
        if directory != source_dir and directory != prepared["directory"] and directory.parent == source_dir:
            shutil.rmtree(directory, ignore_errors=True)
    return store.public(asset)
