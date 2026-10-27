"""Synthetic fixtures test real registration and blending, not AI generation quality."""
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import stitch_engine as engine


def texture(width=512,height=384):
    rng=np.random.default_rng(140)
    image=rng.integers(30,220,(height,width,3),dtype=np.uint8)
    image=cv2.GaussianBlur(image,(3,3),.7)
    for i in range(120):
        x=int(rng.integers(10,width-10));y=int(rng.integers(10,height-10))
        cv2.circle(image,(x,y),int(rng.integers(3,12)),tuple(int(v) for v in rng.integers(10,245,3)),1)
    for row in range(20,height-10,48):cv2.putText(image,f"{row} SIFT",(10,row),cv2.FONT_HERSHEY_SIMPLEX,.42,(240,220,40),1)
    return image


class StitchEngineTests(unittest.TestCase):
    def test_overlap_grid_is_exact_for_all_factors(self):
        for factor in (4,9,16):
            plan=engine.layout(801,603,factor);grid=plan['grid']
            self.assertEqual(len(plan['tiles']),factor)
            self.assertEqual(plan['output_size'],[801*grid,603*grid])
            for tile in plan['tiles']:
                i=tile['index']
                if tile['column']+1<grid:self.assertEqual(tile['box'][2]-plan['tiles'][i+1]['box'][0],64)
                if tile['row']+1<grid:self.assertEqual(tile['box'][3]-plan['tiles'][i+grid]['box'][1],36)
        self.assertEqual(engine.layout(4096,4096,16)['output_size'],[16384,16384])
        with self.assertRaises(engine.StitchError):engine.layout(100,100,16)

    def test_sift_ransac_recovers_single_global_affine(self):
        original=texture();matrix=np.array([[1.025,.008,3.0],[-.006,1.02,-2.0]],np.float64)
        redraw=cv2.warpAffine(original,matrix,(original.shape[1],original.shape[0]),borderMode=cv2.BORDER_REFLECT_101)
        recovered,quality=engine.affine_register(original,redraw)
        self.assertTrue(np.allclose(recovered,cv2.invertAffineTransform(matrix),atol=.35),(recovered,matrix))
        self.assertGreater(quality['inliers'],20)
        self.assertLess(quality['rms_original_pixels'],1)
        self.assertEqual(np.array(quality['matrix']).shape,(2,3))
        with self.assertRaises(engine.StitchError):engine.affine_register(np.zeros((200,200,3),np.uint8),np.zeros((200,200,3),np.uint8))

    def test_slow_color_correction_preserves_redrawn_detail(self):
        original=texture();redraw=np.clip(original.astype(np.int16)+18,0,255).astype(np.uint8)
        corrected=engine.color_match(redraw,original,np.full(original.shape[:2],255,np.uint8))
        before=np.mean(np.abs(original.astype(float)-redraw));after=np.mean(np.abs(original.astype(float)-corrected))
        self.assertLess(after,before*.3)
        detail=lambda a:np.std(cv2.Laplacian(cv2.cvtColor(a,cv2.COLOR_BGR2GRAY),cv2.CV_32F))
        self.assertGreater(detail(corrected),detail(redraw)*.85)

    def test_low_native_resolution_is_not_published_as_superresolution(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',texture(320,256));plan=engine.prepare(folder,4)
            crop=engine.read_bgr(folder/'crops/0.png');engine.write_png(folder/'redraw/0.png',crop)
            with self.assertRaisesRegex(engine.StitchError,'75%'):engine.register_tile(folder,0)

    def test_bounded_outer_edge_extension_handles_affine_translation(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',texture(320,256));plan=engine.prepare(folder,4)
            for tile in plan['tiles']:
                crop=engine.read_bgr(folder/'crops'/f"{tile['index']}.png")
                redraw=cv2.resize(crop,tuple(tile['size']),interpolation=cv2.INTER_CUBIC)
                if tile['column']==0:
                    redraw=cv2.warpAffine(redraw,np.float32([[1,0,-8],[0,1,0]]),tuple(tile['size']),borderMode=cv2.BORDER_REFLECT_101)
                engine.write_png(folder/'redraw'/f"{tile['index']}.png",redraw)
            engine.compose(folder)
            quality=json.loads((folder/'diagnostics/quality.json').read_text())
            self.assertEqual(quality['uncovered_pixels'],0)
            self.assertGreater(sum(a['outer_border_added_pixels'] for a in quality['alignments']),0)
            self.assertTrue(all(a['outer_border_max_pixels']==12*plan['grid'] for a in quality['alignments']))
            self.assertTrue(all(np.array(a['target_matrix']).shape==(2,3) for a in quality['alignments']))

    def test_outer_margin_scales_from_original_coordinates_and_never_fills_interior(self):
        for grid in (2,3,4):
            limit=12*grid;valid=np.full((240,240),255,np.uint8);valid[:,:limit-4]=0;valid[90:110,90:110]=0
            tile={'corner':[0,0],'size':[240,240]};plan={'grid':grid,'output_size':[240*grid,240*grid]}
            mask,metrics=engine.registration_mask(valid,tile,plan)
            self.assertTrue(np.all(mask[:,0]>0));self.assertEqual(mask[100,100],0)
            self.assertEqual(metrics['outer_border_max_pixels'],limit)
            valid[:,:limit+8]=0;mask,_=engine.registration_mask(valid,tile,plan)
            self.assertEqual(mask[160,0],0,'Deficits beyond the bound must remain invalid')

    def test_sixteen_tiles_accept_bounded_translation_and_reject_missing_core(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',texture());plan=engine.prepare(folder,16);tile=plan['tiles'][12]
            crop=engine.read_bgr(folder/'crops/12.png');native=cv2.resize(crop,tuple(tile['size']),interpolation=cv2.INTER_CUBIC)
            for shift,accepted in ((-40,True),(-88,False)):
                redraw=cv2.warpAffine(native,np.float32([[1,0,shift],[0,1,0]]),tuple(tile['size']),borderMode=cv2.BORDER_REFLECT_101)
                engine.write_png(folder/'redraw/12.png',redraw)
                if accepted:
                    metrics=engine.register_tile(folder,12);self.assertEqual(metrics['outer_border_max_pixels'],48)
                    self.assertGreater(metrics['outer_border_added_pixels'],0)
                    mask=cv2.imread(str(folder/'masks/valid-12.png'),0);self.assertTrue(np.all(mask[:,0]>0))
                else:
                    with self.assertRaisesRegex(engine.StitchError,'核心区域仍缺失'):engine.register_tile(folder,12)

    def test_reregistering_invalidates_stale_composition_and_visual_review(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);engine.write_png(folder/'base.png',texture(320,256));plan=engine.prepare(folder,4)
            crop=engine.read_bgr(folder/'crops/0.png');engine.write_png(folder/'redraw/0.png',cv2.resize(crop,tuple(plan['tiles'][0]['size'])))
            stale=('candidate.png','inspection.png','overview.png','diagnostics/quality.json','diagnostics/visual-review.json')
            for name in stale:(folder/name).write_text('stale checkpoint')
            engine.register_tile(folder,0)
            self.assertTrue(all(not (folder/name).exists() for name in stale))

    def test_real_graphcut_and_seven_band_blend_for_4_9_16(self):
        for factor in (4,9,16):
            with self.subTest(factor=factor),tempfile.TemporaryDirectory() as temporary:
                folder=Path(temporary);original=texture()
                engine.write_png(folder/'base.png',original);plan=engine.prepare(folder,factor)
                for tile in plan['tiles']:
                    crop=engine.read_bgr(folder/'crops'/f"{tile['index']}.png")
                    # Test fixture only: the production path requires a real image-generation result.
                    redraw=cv2.resize(crop,tuple(tile['size']),interpolation=cv2.INTER_CUBIC)
                    engine.write_png(folder/'redraw'/f"{tile['index']}.png",redraw)
                engine.compose(folder)
                with Image.open(folder/'candidate.png') as result:self.assertEqual(list(result.size),plan['output_size'])
                quality=json.loads((folder/'diagnostics/quality.json').read_text())
                self.assertEqual(quality['uncovered_pixels'],0)
                self.assertEqual(quality['bands'],7)
                self.assertEqual(quality['seam'],'GraphCut/COST_COLOR_GRAD')
                self.assertFalse(quality['optical_flow'])
                self.assertTrue((folder/'inspection.png').is_file())
                self.assertFalse((folder/'canvas.rgb').exists())


if __name__=='__main__':unittest.main()
