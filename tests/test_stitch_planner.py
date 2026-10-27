"""Geometry and budget contracts for the standalone progressive prototype."""
import math
import random
import unittest

from stitch_planner import PlanError, Policy, iter_tiles, progressive_plan


class PlannerTests(unittest.TestCase):
    def assert_geometry(self, plan):
        previous=plan['input_size']
        for stage in plan['stages']:
            self.assertEqual(stage['input_size'],previous)
            self.assertEqual(stage['output_size'],[v*2 for v in previous])
            previous=stage['output_size']
            w,h=stage['input_size']
            tiles=list(iter_tiles(stage))
            self.assertEqual(len(tiles),stage['tile_count'])
            core_area=0
            for tile in tiles:
                x0,y0,x1,y1=tile['box'];a,b,c,d=tile['core']
                self.assertTrue(0<=x0<=a<c<=x1<=w)
                self.assertTrue(0<=y0<=b<d<=y1<=h)
                core_area+=(c-a)*(d-b)
                self.assertLessEqual(max(x1-x0,y1-y0),2*min(x1-x0,y1-y0))
                self.assertLessEqual(math.prod(tile['size']),stage['tile_output_limit'])
                self.assertEqual(tile['corner'],[x0*2,y0*2])
            self.assertEqual(core_area,w*h)
            for key,length in (('x',w),('y',h)):
                axis=stage['axes'][key]
                self.assertEqual((axis['cuts'][0],axis['cuts'][-1]),(0,length))
                self.assertEqual((axis['crops'][0][0],axis['crops'][-1][1]),(0,length))
                self.assertEqual(len(set(axis['cuts'])),len(axis['cuts']))
                for left,right in zip(axis['crops'],axis['crops'][1:]):
                    overlap=left[1]-right[0]
                    self.assertGreaterEqual(overlap,axis['span']*plan['policy']['overlap']-2)
        self.assertEqual(previous,plan['output_size'])
        self.assertEqual(math.prod(previous),math.prod(plan['input_size'])*plan['factor'])

    def test_extreme_examples_cover_every_pixel_and_fit_the_per_call_budget(self):
        cases=[(32,32),(64,16),(16,64),(8192,64),(64,8192),
               (1056,1490),(941,1672),(1000,1000),(4096,4096),(8192,2048)]
        for w,h in cases:
            for factor in (4,16,64):
                with self.subTest(size=(w,h),factor=factor):self.assert_geometry(progressive_plan(w,h,factor))

    def test_common_noninteger_ratios_cover_every_pixel_and_fit_budget(self):
        from scripts.preview_stitch_plan import COMMON_CASES
        for name,w,h in COMMON_CASES:
            with self.subTest(aspect=name,size=(w,h)):
                full=progressive_plan(w,h,64)
                self.assert_geometry(full)
                for factor,count in ((4,1),(16,2)):
                    prefix=progressive_plan(w,h,factor)
                    self.assertEqual(prefix['stages'],full['stages'][:count])

    def test_every_stage_retiles_the_full_previous_canvas(self):
        plan=progressive_plan(1056,1490,16)
        first,second=plan['stages']
        self.assertEqual(second['input_size'],first['output_size'])
        self.assertEqual(second['input_size'],[2112,2980])
        self.assertNotEqual(first['crop_size'],second['crop_size'])
        self.assertNotEqual((first['columns'],first['rows']),(second['columns'],second['rows']))
        self.assertGreater(second['tile_count'],first['tile_count'])

    def test_tiny_square_is_not_split_just_to_approach_four_thirds(self):
        self.assertEqual([s['tile_count'] for s in progressive_plan(32,32,64)['stages']],[1,1,1])

    def test_small_extreme_aspects_need_only_one_cell_on_the_short_axis(self):
        for w,h in ((64,16),(16,64),(1,7),(7,1),(1,128),(128,1)):
            plan=progressive_plan(w,h,64);self.assert_geometry(plan)
            self.assertTrue(all(min(s['columns'],s['rows'])<=2 for s in plan['stages']))

    def test_large_images_can_split_both_axes_beyond_two(self):
        stage=progressive_plan(4096,4096,4)['stages'][0]
        self.assertGreater(min(stage['columns'],stage['rows']),2)
        self.assertLessEqual(math.prod(stage['crop_size']),Policy().tile_output_limit//4)

    def test_old_seams_are_scored_in_current_canvas_coordinates(self):
        plan=progressive_plan(1056,1490,16)
        first,second=plan['stages']
        for key in ('x','y'):
            metric=second['old_seam_coverage'][key]
            self.assertEqual(metric['total'],len(first['output_seams'][key]))
            self.assertEqual(metric['fraction'],1)
            axis=second['axes'][key]
            for seam in first['output_seams'][key]:
                self.assertTrue(any(a+axis['span']/4<=seam<=b-axis['span']/4 for a,b in axis['crops']))

    def test_calls_include_shift_edge_windows_and_per_stage_reviews(self):
        plan=progressive_plan(64,16,16)
        self.assertEqual([s['tile_count'] for s in plan['stages']],[3,4])
        self.assertEqual(plan['budget'],{'images':7,'reviews':2,'calls':9,'max_calls':23})

    def test_limits_are_reported_without_silently_shrinking_theoretical_result(self):
        self.assertTrue(progressive_plan(1000,1000,64)['executable_with_current_limits'])
        policy=Policy(max_canvas_pixels=64_000_000,max_canvas_edge=32699)
        pixels=progressive_plan(1024,1024,64,policy=policy)
        self.assertFalse(pixels['executable_with_current_limits'])
        self.assertEqual(pixels['output_size'],[8192,8192])
        edge=progressive_plan(8192,64,16,policy=policy)
        self.assertFalse(edge['executable_with_current_limits'])
        self.assertEqual(edge['output_size'],[32768,256])
        self.assertTrue(any('最长边' in reason for reason in edge['limits']))
        self.assertTrue(progressive_plan(4096,4096,64)['executable_with_current_limits'])

    def test_pixel_rounding_on_odd_and_random_sizes_never_leaves_holes(self):
        rng=random.Random(20261027)
        cases=[(1,1),(3,9),(49,97),(333,777),(941,1673)]
        cases += [(rng.randint(16,3000),rng.randint(16,3000)) for _ in range(40)]
        for w,h in cases:
            with self.subTest(size=(w,h)):self.assert_geometry(progressive_plan(w,h,64))

    def test_invalid_sizes_and_units_are_rejected(self):
        for args in ((0,32,4),(-1,32,4),(1.5,32,4),(True,32,4),(32,32,9),(32,32,2)):
            with self.assertRaises(PlanError):progressive_plan(*args)
        for settings in ({'overlap':.5},{'safety':0},{'native_pixels':0},{'max_attempts':0}):
            with self.assertRaises(PlanError):Policy(**settings)


if __name__=='__main__':unittest.main()
