"""Shared, dynamically sized CLI permits, with round-robin fairness between jobs."""
from __future__ import annotations

import asyncio
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from itertools import count


class CallPool:
    def __init__(self, limit, paused):
        self.loop=asyncio.get_running_loop()
        self.get_limit=limit;self.get_paused=paused
        self.pending=OrderedDict();self.active={};self.sequence=count(1)
        self.waiting=0;self.limit=1;self.paused=False;self.closed=False
        self.refresh()

    def snapshot(self):
        return {"active":len(self.active),"waiting":self.waiting,"limit":self.limit,"paused":self.paused}

    def notify(self):
        if not self.loop.is_closed():self.loop.call_soon_threadsafe(self.refresh)

    def refresh(self):
        if self.closed:return
        self.limit=max(1,int(self.get_limit()));self.paused=bool(self.get_paused())
        if self.paused:return
        while len(self.active)<self.limit and self.pending:
            owner,queue=self.pending.popitem(last=False)
            token,future,label=queue.popleft();self.waiting-=1
            if queue:self.pending[owner]=queue
            if future.cancelled():continue
            self.active[token]={"owner":owner,"label":label}
            future.set_result(token)

    @asynccontextmanager
    async def slot(self, owner, label=""):
        if self.closed:raise asyncio.CancelledError()
        token=next(self.sequence);future=self.loop.create_future()
        self.pending.setdefault(owner,deque()).append((token,future,label));self.waiting+=1
        try:
            self.refresh()
            await future
            yield token
        finally:
            self.active.pop(token,None)
            queue=self.pending.get(owner)
            if queue:
                remaining=deque(item for item in queue if item[0]!=token)
                self.waiting-=len(queue)-len(remaining)
                if remaining:self.pending[owner]=remaining
                else:self.pending.pop(owner,None)
            if not future.done():future.cancel()
            self.refresh()

    def cancel_owner(self, owner):
        queue=self.pending.pop(owner,())
        self.waiting-=len(queue)
        for _,future,_ in queue:future.cancel()
        self.refresh()

    def close(self):
        self.closed=True
        for queue in self.pending.values():
            for _,future,_ in queue:future.cancel()
        self.pending.clear();self.waiting=0
