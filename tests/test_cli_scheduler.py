import asyncio
import unittest

from cli_scheduler import CallPool


class CallPoolTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.config={'limit':1,'paused':False}
        self.pool=CallPool(lambda:self.config['limit'],lambda:self.config['paused'])

    async def asyncTearDown(self):
        self.pool.close()
        self.assertEqual(self.pool.snapshot()['active'],0)
        self.assertEqual(self.pool.snapshot()['waiting'],0)

    async def test_limit_increase_and_decrease_apply_to_existing_waiters(self):
        entered=[];releases=[asyncio.Event() for _ in range(4)]
        async def call(i):
            async with self.pool.slot('job',str(i)):
                entered.append(i);await releases[i].wait()
        tasks=[asyncio.create_task(call(i)) for i in range(4)]
        await asyncio.sleep(.02);self.assertEqual(entered,[0])
        self.config['limit']=3;self.pool.refresh();await asyncio.sleep(.02)
        self.assertEqual(entered,[0,1,2])
        self.config['limit']=1;self.pool.refresh();releases[0].set();releases[1].set();await asyncio.sleep(.02)
        self.assertEqual(entered,[0,1,2])
        releases[2].set();await asyncio.sleep(.02);self.assertEqual(entered,[0,1,2,3])
        releases[3].set();await asyncio.gather(*tasks)

    async def test_round_robin_does_not_let_one_job_consume_entire_backlog(self):
        order=[];hold=asyncio.Event()
        async def call(owner,label,block=False):
            async with self.pool.slot(owner,label):
                order.append(label)
                if block:await hold.wait()
        first=asyncio.create_task(call('a','a0',True));await asyncio.sleep(.01)
        pending=[asyncio.create_task(call('a',f'a{i}')) for i in range(1,5)]
        pending.append(asyncio.create_task(call('b','b0')))
        await asyncio.sleep(.01);hold.set();await asyncio.gather(first,*pending)
        self.assertLess(order.index('b0'),order.index('a4'))

    async def test_pause_and_owner_cancellation_remove_queued_permits(self):
        self.config['paused']=True;self.pool.refresh()
        entered=[]
        async def call(owner):
            async with self.pool.slot(owner):entered.append(owner)
        a=asyncio.create_task(call('a'));b=asyncio.create_task(call('b'))
        await asyncio.sleep(.01);self.assertEqual(entered,[])
        self.pool.cancel_owner('a');self.config['paused']=False;self.pool.refresh()
        await asyncio.gather(a,b,return_exceptions=True)
        self.assertTrue(a.cancelled());self.assertEqual(entered,['b'])

    async def test_cancelling_just_granted_permit_does_not_leak_capacity(self):
        async def call():
            async with self.pool.slot('a'):await asyncio.sleep(20)
        task=asyncio.create_task(call());await asyncio.sleep(.01);task.cancel()
        await asyncio.gather(task,return_exceptions=True)
        self.assertEqual(self.pool.snapshot()['active'],0)
