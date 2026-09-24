import base64
import hashlib
import io
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

import av
import numpy as np
from PIL import Image

from backend import media
from backend.media_editor import browser_source, normalize_edit, prepare_edit, commit_edit, video_frame


def make_video(path, duration=4, audio=True, variable=False):
    with av.open(str(path), 'w') as output:
        stream = output.add_stream('libx264', rate=25)
        stream.width, stream.height, stream.pix_fmt = 160, 96, 'yuv420p'
        stream.time_base = Fraction(1, 1000)
        stream.codec_context.time_base = Fraction(1, 1000)
        audio_stream = output.add_stream('aac', rate=48000) if audio else None
        if audio_stream: audio_stream.layout = 'mono'
        for i in range(round(duration*25)):
            frame = av.VideoFrame.from_image(Image.new('RGB', (160,96), (i*5 % 255,80,120)))
            frame.pts = i*40 + (10 if variable and i%2 else 0)
            frame.time_base = Fraction(1,1000)
            for packet in stream.encode(frame): output.mux(packet)
        for packet in stream.encode(): output.mux(packet)
        if audio:
            for pts in range(0,round(duration*48000),1024):
                count = min(1024,round(duration*48000)-pts)
                samples = (.15*np.sin(2*np.pi*440*np.arange(pts,pts+count)/48000)).astype(np.float32).reshape(1,-1)
                frame = av.AudioFrame.from_ndarray(samples,format='fltp',layout='mono')
                frame.sample_rate=48000;frame.pts=pts;frame.time_base=Fraction(1,48000)
                for packet in audio_stream.encode(frame): output.mux(packet)
            for packet in audio_stream.encode(): output.mux(packet)


class MediaEditorTests(unittest.TestCase):
    def test_extract_audio_uses_trim_and_preserves_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "video"; root.mkdir()
            source = root / "original.mp4"; make_video(source)
            original = source.read_bytes()
            store = media.MediaStore(); store.add("session", "Reference", "video.mp4", "video/mp4", source)
            asset = store.get("session", "video")
            result = prepare_edit(asset, {"revision":0, "start":.4, "end":2.8}, "audio")
            with av.open(str(result["target"])) as output:
                self.assertEqual(len(output.streams.video), 0)
                samples = list(output.decode(audio=0))
            self.assertAlmostEqual(sum(f.samples for f in samples) / 48000, 2.4, places=3)
            self.assertGreater(float(np.abs(samples[0].to_ndarray()).max()), 100)
            self.assertEqual(source.read_bytes(), original)
            self.assertEqual(asset.get("content_revision", 0), 0)
            with self.assertRaises(media.MediaError):
                prepare_edit(asset, {"revision":0, "start":0, "end":1}, "audio")
            silent = root / "silent.mp4"; make_video(silent, audio=False)
            asset = {**asset, "_original_path":str(silent)}
            with self.assertRaises(media.MediaError) as error:
                prepare_edit(asset, {"revision":0, "start":0, "end":2}, "audio")
            self.assertEqual(error.exception.code, "NO_AUDIO")

    def test_current_frame_png_uses_playhead_draft_crop_without_applying(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'video';root.mkdir();path=root/'original.mp4';make_video(path,audio=False)
            store=media.MediaStore();store.add('session','Reference','clip.mp4','video/mp4',path)
            asset=store.get('session','video')
            before=store.public(asset)
            result=video_frame(asset,.415,0,{'x':16,'y':8,'w':96,'h':64},True)
            self.assertAlmostEqual(result['timestamp'],.4,places=4)
            with Image.open(io.BytesIO(base64.b64decode(result['image'].split(',')[1]))) as frame:
                self.assertEqual(frame.format,'PNG')
                self.assertEqual(frame.size,(96,64))
            self.assertEqual(store.public(asset),before)
            prepared=prepare_edit(asset,{'revision':0,'frame_count_mode':'24'},'save')
            commit_edit(store,'session','video',prepared)
            self.assertEqual(asset['frame_count'],24)

    def test_picture_edits_preserve_source_and_reset_without_crop_chain(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'session'/'picture';root.mkdir(parents=True)
            source=root/'original.png';Image.new('RGB',(160,96),'red').save(source)
            original=source.read_bytes();store=media.MediaStore()
            store.add('session','Reference','photo.png','image/png',source)
            asset=store.get('session','picture')
            prepared=prepare_edit(asset,{'revision':0,'crop':{'x':10,'y':5,'w':64,'h':64}},'save')
            result=commit_edit(store,'session','picture',prepared)
            self.assertEqual((result['width'],result['height']),(64,64))
            self.assertEqual(result['source']['width'],160)
            self.assertEqual(source.read_bytes(),original)
            prepared=prepare_edit(asset,{'revision':1},'save')
            result=commit_edit(store,'session','picture',prepared)
            self.assertEqual((result['width'],result['height']),(160,96))
            self.assertTrue(source.exists())
            with self.assertRaises(media.MediaError):prepare_edit(asset,{'revision':0},'save')

    def test_real_video_trim_crop_audio_and_preview_are_consistent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'video';root.mkdir();source=root/'original.mp4';make_video(source)
            original=hashlib.sha256(source.read_bytes()).digest();store=media.MediaStore()
            store.add('session','Reference','video.mp4','video/mp4',source);asset=store.get('session','video')
            body={'revision':0,'start':.4,'end':2.8,'crop':{'x':16,'y':16,'w':128,'h':64},'frame_count_mode':'4'}
            preview=prepare_edit(asset,body,'preview')
            self.assertEqual(len(preview['frames']),4)
            self.assertAlmostEqual(preview['duration'],2.4,places=3)
            prepared=prepare_edit(asset,body,'save')
            with av.open(str(prepared['target'])) as output:
                self.assertEqual(len(output.streams.audio),1)
                self.assertEqual((output.streams.video[0].width,output.streams.video[0].height),(128,64))
                self.assertAlmostEqual(float(output.duration/av.time_base),2.4,delta=.05)
                samples=list(output.decode(audio=0));self.assertTrue(samples)
                self.assertGreater(float(np.abs(samples[0].to_ndarray()).max()),.01)
            result=commit_edit(store,'session','video',prepared)
            self.assertEqual(result['reference'],'<Video 1>')
            self.assertEqual(result['frame_count'],4)
            self.assertEqual(hashlib.sha256(source.read_bytes()).digest(),original)
            edited=Path(asset['_edited_path']);store.resample('session','video','8')
            self.assertTrue(edited.exists());self.assertEqual(asset['width'],128)
            self.assertEqual(asset['frame_count'],8)
            self.assertAlmostEqual(asset['duration'],2.4,places=3)

    def test_long_source_is_editable_but_not_a_model_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'video';root.mkdir();source=root/'original.mp4';source.touch()
            store=media.MediaStore()
            with patch.object(media,'process_video',return_value={'duration':60,'width':160,'height':96}):
                result=store.add('session','Reference','long.mp4','video/mp4',source)
            self.assertIsNone(result['reference']);self.assertEqual(result['status'],'needs_edit')
            self.assertEqual(store.manifest('session','Reference')['assets'],[])
            self.assertTrue(store.manifest('session','Reference')['valid'])

    def test_total_warning_is_not_a_manifest_violation(self):
        store=media.MediaStore();store.sessions['session']=[{'id':str(i),'session_id':'session','mode':'Reference','type':'video','duration':8,'reference':f'<Video {i+1}>'} for i in range(2)]
        manifest=store.manifest('session','Reference')
        self.assertTrue(manifest['valid']);self.assertEqual(len(manifest['warnings']),1)
        self.assertEqual(len(manifest['assets']),2)

    def test_invalid_geometry_and_times_fail_before_processing(self):
        asset={'type':'video','width':160,'height':96,'duration':4}
        for body in [{'start':float('nan')},{'start':3,'end':2},{'end':5},{'crop':{'x':0,'y':0,'w':161,'h':32}},{'sample_index':-1},{'include_endpoints':'yes'}]:
            with self.subTest(body=body),self.assertRaises(media.MediaError):normalize_edit(asset,body)

    def test_frame_step_uses_decoded_vfr_timestamps(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'vfr.mp4';make_video(path,audio=False,variable=True)
            asset={'_original_path':str(path),'duration':4}
            with av.open(str(path)) as container:times=[float(f.time) for f in container.decode(video=0)]
            previous=video_frame(asset,times[10],-1);following=video_frame(asset,times[10],1)
            self.assertAlmostEqual(previous['timestamp'],times[9],places=4)
            self.assertAlmostEqual(following['timestamp'],times[11],places=4)
            self.assertTrue(following['image'].startswith('data:image/jpeg;base64,'))

    def test_vfr_export_retains_presentation_intervals(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'video';root.mkdir();path=root/'original.mp4';make_video(path,audio=False,variable=True)
            store=media.MediaStore();store.add('session','Reference','clip.mp4','video/mp4',path)
            with av.open(str(path)) as container:original=[float(f.time) for f in container.decode(video=0) if .4<=float(f.time)<2.8]
            prepared=prepare_edit(store.get('session','video'),{'revision':0,'start':.4,'end':2.8},'save')
            with av.open(str(prepared['target'])) as container:edited=[float(f.time) for f in container.decode(video=0)]
            self.assertEqual(len(original),len(edited))
            self.assertGreater(max(np.diff(original))-min(np.diff(original)),.015)
            for a,b in zip(np.diff(original),np.diff(edited)):self.assertAlmostEqual(a,b,places=4)

    def test_non_browser_image_source_is_lossless_full_size_and_cached(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'picture';root.mkdir();path=root/'original.tiff';Image.new('CMYK',(160,96)).save(path)
            store=media.MediaStore();store.add('session','Reference','image.tiff','image/tiff',path)
            asset=store.get('session','picture');view=browser_source(asset)
            with Image.open(view) as image:self.assertEqual(image.size,(160,96))
            self.assertEqual(browser_source(asset),view)
            self.assertEqual(asset['_original_path'],str(path))
            prepared=prepare_edit(asset,{'revision':0},'save')
            self.assertTrue(prepared['target'].is_file())

    def test_silent_video_download_and_unaligned_trim(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'video';root.mkdir();path=root/'original.mp4';make_video(path,audio=False)
            store=media.MediaStore();store.add('session','Reference','clip.mp4','video/mp4',path)
            asset=store.get('session','video')
            prepared=prepare_edit(asset,{'revision':0,'start':.413,'end':2.837},'download')
            with av.open(str(prepared['target'])) as output:
                self.assertEqual(len(output.streams.audio),0)
                self.assertAlmostEqual(float(output.duration/av.time_base),2.424,delta=.05)
                self.assertEqual(prepared['processed']['duration'],round(float(output.duration/av.time_base),3))
                frames=list(output.decode(video=0));self.assertTrue(frames)
                self.assertTrue(all(a.pts<b.pts for a,b in zip(frames,frames[1:])))
            self.assertNotIn('edit',asset)
            self.assertEqual(store.manifest('session','Reference')['assets'][0]['duration'],4)

    def test_long_source_promotes_only_after_valid_save(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'video';root.mkdir();path=root/'original.mp4';make_video(path,duration=16,audio=False)
            store=media.MediaStore();store.add('session','Reference','clip.mp4','video/mp4',path)
            asset=store.get('session','video');self.assertIsNone(asset['reference'])
            original=path.read_bytes()
            prepared=prepare_edit(asset,{'revision':0,'start':0,'end':16,'frame_count_mode':'24',
                                        'crop':{'x':0,'y':0,'w':128,'h':64},'include_endpoints':False},'save')
            applied=commit_edit(store,'session','video',prepared)
            self.assertIsNone(applied['reference']);self.assertEqual(applied['status'],'needs_edit')
            self.assertEqual(applied['frame_count'],24);self.assertFalse(applied['include_endpoints'])
            self.assertEqual((applied['width'],applied['height']),(128,64))
            self.assertTrue(applied['contact_sheet_url'])
            self.assertEqual(store.manifest('session','Reference')['assets'],[])
            self.assertEqual(path.read_bytes(),original)
            prepared=prepare_edit(asset,{'revision':1,'start':1,'end':4},'save')
            commit_edit(store,'session','video',prepared)
            self.assertEqual(asset['reference'],'<Video 1>')
            self.assertEqual(asset['duration'],3)
            self.assertEqual(asset['source']['duration'],16)
            self.assertEqual(len(store.manifest('session','Reference')['assets']),1)
            prepared=prepare_edit(asset,{'revision':2,'start':0,'end':16},'save')
            commit_edit(store,'session','video',prepared)
            self.assertIsNone(asset['reference'])
            self.assertEqual(store.manifest('session','Reference')['assets'],[])
            self.assertEqual(path.read_bytes(),original)

class ReferencePromotionTests(unittest.TestCase):
    def test_staged_promotion_keeps_existing_ready_video_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            original=root/'original.mp4';original.touch()
            target=root/'edited.mp4';target.write_bytes(b'video')
            staged={'id':'staged','session_id':'s','mode':'Reference','type':'video','status':'needs_edit',
                    'reference':None,'_original_path':str(original),'duration':30}
            ready={'id':'ready','session_id':'s','mode':'Reference','type':'video','status':'ready',
                   'reference':'<Video 1>','duration':8}
            store=media.MediaStore();store.sessions['s']=[staged,ready]
            prepared={'source':str(original),'revision':0,'processed':{'duration':8},'edit':{},
                      'target':target,'directory':root}
            promoted=commit_edit(store,'s','staged',prepared)
            self.assertEqual(ready['reference'],'<Video 1>')
            self.assertEqual(promoted['reference'],'<Video 2>')
            self.assertEqual([a['id'] for a in store.manifest('s','Reference')['assets']],['ready','staged'])

    def test_active_reference_labels_follow_order_without_changing_asset_ids(self):
        first = dict(id="first", mode="Reference", type="video", status="ready", reference="<Video 1>")
        second = dict(id="second", mode="Reference", type="video", status="ready", reference="<Video 2>")
        staged = dict(id="staged", mode="Reference", type="video", status="needs_edit", reference=None)
        assets = [second, staged, first]
        media.MediaStore._renumber(assets, "Reference")
        self.assertEqual([a["reference"] for a in assets], ["<Video 1>", None, "<Video 2>"])
        assets.remove(second)
        media.MediaStore._renumber(assets, "Reference")
        self.assertEqual(first["reference"], "<Video 1>")
        self.assertEqual(first["id"], "first")
        staged["status"] = "ready"
        media.MediaStore._renumber(assets, "Reference")
        self.assertEqual([a["reference"] for a in assets], ["<Video 1>", "<Video 2>"])
