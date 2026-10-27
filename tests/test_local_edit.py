import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageChops
from local_edit import compose, context_box, prepare


class LocalEditTests(unittest.TestCase):
    def test_selected_rectangle_is_the_only_changed_area_including_alpha(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);original=Image.new('RGBA',(240,180),(20,80,120,73));original.save(folder/'source.png')
            Image.new('RGBA',(512,512),(220,40,60,255)).save(folder/'redraw.png')
            region={'x':0,'y':40,'width':90,'height':85}
            compose(folder/'source.png',folder/'redraw.png',region,folder/'result.png')
            with Image.open(folder/'result.png') as result:
                self.assertEqual(result.size,original.size)
                difference=ImageChops.difference(original,result)
                self.assertEqual(difference.getbbox(),(0,40,90,125))
                self.assertEqual(result.getpixel((120,100)),original.getpixel((120,100)))
                self.assertEqual(result.getpixel((40,80)),(220,40,60,255))
                self.assertEqual(result.getpixel((0,80)),(220,40,60,255),'A selection touching the image edge must fully replace that edge')

    def test_context_and_selection_map_use_the_same_native_coordinates(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);Image.new('RGB',(300,200),'green').save(folder/'source.png')
            region={'x':40,'y':70,'width':80,'height':60}
            brief,refs,size=prepare(folder/'source.png',folder/'job',region,'将花朵改成红色')
            self.assertEqual(size,(144,124));self.assertEqual(len(refs),3)
            with Image.open(refs[2]) as mask:self.assertEqual(mask.getbbox(),(32,32,112,92))
            self.assertIn('将花朵改成红色',brief)
            self.assertIn('黑色部分保持原样',brief)
            for region in ({'x':-1,'y':0,'width':40,'height':40},{'x':280,'y':0,'width':40,'height':40},{'x':0,'y':0,'width':15,'height':40}):
                with self.assertRaises(ValueError):context_box((300,200),region)
