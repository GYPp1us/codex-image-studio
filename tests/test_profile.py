"""Account appearance and avatar storage never invoke image generation."""
import importlib
import io
import os
import tempfile
import unittest
from fastapi.testclient import TestClient
from PIL import Image


class ProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory()
        os.environ['STUDIO_DATA']=cls.temp.name
        os.environ['STUDIO_SETUP_TOKEN']='profile-test-only'
        os.environ.pop('STUDIO_SETUP_TOKEN_FILE',None)
        import app
        cls.studio=importlib.reload(app)
        cls.client=TestClient(cls.studio.app,base_url='https://image.test')
        cls.client.__enter__()
        result=cls.client.post('/api/auth/setup',json={'username':'profile','password':'test-profile-password','setup_token':'profile-test-only'})
        cls.headers={'X-CSRF-Token':result.json()['csrf'],'Origin':'https://image.test'}
        cls.studio.set_setting('paused',True)

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None,None,None)
        cls.temp.cleanup()

    def setUp(self):
        self.studio.set_setting('storage_limit_bytes',0)
        self.client.delete('/api/account/avatar',headers=self.headers)

    def upload(self,color='red'):
        data=io.BytesIO();Image.new('RGB',(960,640),color).save(data,'PNG')
        return self.client.post('/api/account/avatar',files={'file':('portrait.png',data.getvalue(),'image/png')},headers=self.headers)

    def test_avatar_is_bounded_private_and_not_a_reference(self):
        before=self.studio.query('SELECT COUNT(*) n FROM assets',one=True)['n']
        result=self.upload();self.assertEqual(result.status_code,200,result.text)
        url=result.json()['avatar_url'];self.assertTrue(url.startswith('/api/account/avatar?v='))
        photo=self.client.get(url);self.assertEqual(photo.status_code,200)
        with Image.open(io.BytesIO(photo.content)) as image:
            self.assertEqual(image.size,(512,512));self.assertEqual(image.format,'WEBP');self.assertFalse(image.getexif())
        self.assertEqual(self.client.get('/api/account').json()['avatar_url'],url)
        self.assertEqual(self.studio.query('SELECT COUNT(*) n FROM assets',one=True)['n'],before)
        anonymous=TestClient(self.studio.app,base_url='https://image.test')
        self.assertEqual(anonymous.get(url).status_code,401)
        anonymous.close()

    def test_replacing_and_resetting_avatar_reclaims_only_old_portrait(self):
        self.upload();old=self.studio.account_profile.avatar_path(self.studio,self.studio.setting('avatar_revision'))
        self.upload('blue');self.assertFalse(old.exists())
        path=self.studio.account_profile.avatar_path(self.studio,self.studio.setting('avatar_revision'))
        self.assertTrue(path.exists())
        result=self.client.delete('/api/account/avatar',headers=self.headers)
        self.assertEqual(result.json()['avatar_url'],'');self.assertFalse(path.exists())
        self.assertEqual(self.client.get('/api/account/avatar').status_code,404)
        self.assertEqual(self.client.get('/api/account').status_code,200)
        self.assertEqual(self.client.delete('/api/account/avatar',headers=self.headers).status_code,200)

    def test_avatar_rejects_invalid_large_and_unprotected_uploads(self):
        self.assertEqual(self.client.post('/api/account/avatar',files={'file':('x.png',b'not an image','image/png')},headers=self.headers).status_code,400)
        self.assertEqual(self.client.post('/api/account/avatar',files={'file':('large.png',b'x'*(12*1024*1024+1),'image/png')},headers=self.headers).status_code,413)
        self.assertEqual(self.client.post('/api/account/avatar',files={'file':('x.png',b'x','image/png')}).status_code,403)
        self.assertEqual(self.client.delete('/api/account/avatar',headers={**self.headers,'Origin':'https://foreign.test'}).status_code,403)

    def test_storage_limit_preserves_previous_avatar_on_failure(self):
        self.upload();previous=self.client.get('/api/account').json()['avatar_url']
        self.studio.set_setting('storage_limit_bytes',1)
        result=self.upload('green');self.assertEqual(result.status_code,507,result.text)
        self.assertEqual(self.client.get('/api/account').json()['avatar_url'],previous)

    def test_appearance_roundtrips_and_validates_without_touching_queue(self):
        result=self.client.patch('/api/settings',json={'appearance':{'mode':'dark','accent':'#Aa33Ff'}},headers=self.headers)
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(self.client.get('/api/settings').json()['appearance'],{'mode':'dark','accent':'#Aa33Ff'})
        self.assertTrue(self.studio.setting('paused'))
        for value in ({'mode':'neon'},{'accent':'red'},{'accent':'#fff;display:none'}):
            self.assertEqual(self.client.patch('/api/settings',json={'appearance':value},headers=self.headers).status_code,422)

    def test_reference_only_template_keeps_explicit_reference_order(self):
        ids=[]
        for color in ('orange','purple'):
            data=io.BytesIO();Image.new('RGB',(96,64),color).save(data,'PNG')
            ids.append(self.client.post('/api/assets',files={'file':('ref.png',data.getvalue(),'image/png')},headers=self.headers).json()['asset']['id'])
        result=self.client.post('/api/templates',json={'title':'References only','text':'','refs':ids},headers=self.headers)
        self.assertEqual(result.status_code,200,result.text)
        template=result.json();result=self.client.put('/api/templates/'+template['id'],json={'title':template['title'],'text':'','refs':list(reversed(ids))},headers=self.headers)
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['refs'],list(reversed(ids)));self.assertEqual(result.json()['text'],'')
