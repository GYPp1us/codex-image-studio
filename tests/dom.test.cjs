const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
require('../static/dom.js');
const {updateHTML}=globalThis.StudioDOM;
function fixture(){return parseHTML('<html><body><div id="list"></div></body></html>').document.getElementById('list');}
test('an unchanged poll preserves decoded thumbnail elements',()=>{
  const list=fixture(),html='<article data-id="a"><img src="/media/a?thumbnail=1"><span>已完成</span></article>';
  updateHTML(list,html);const image=list.querySelector('img');
  for(let i=0;i<10;i++)updateHTML(list,html);
  assert.equal(list.querySelector('img'),image);
});
test('queue status changes do not recreate existing thumbnails',()=>{
  const list=fixture();
  updateHTML(list,'<article data-id="a"><img src="/media/a"><span>已完成</span></article><article data-id="b"><span>等待中</span></article>');
  const image=list.querySelector('img'),first=list.firstChild;
  updateHTML(list,'<article data-id="b"><span>生成中</span></article><article data-id="a"><img src="/media/a"><span>已完成</span></article>');
  assert.equal(list.querySelector('img'),image);assert.equal(list.lastChild,first);assert.match(list.textContent,/生成中/);
});
test('only the changed image source is replaced, while removals and new cards reconcile',()=>{
  const list=fixture();updateHTML(list,'<div data-id="a"><img src="/media/a"></div><div data-id="b"><img src="/media/b"></div>');
  const b=list.lastChild,image=b.firstChild;
  updateHTML(list,'<div data-id="c"><img src="/media/c"></div><div data-id="b"><img src="/media/b-new"></div>');
  assert.equal(list.lastChild,b);assert.equal(b.firstChild,image);assert.equal(image.getAttribute('src'),'/media/b-new');assert.equal(list.children.length,2);
});
test('progress updates retain the fill element so CSS easing continues across polls',()=>{
  const list=fixture();
  updateHTML(list,'<div class="motion-track"><span class="motion-fill p22"></span></div>');
  const fill=list.querySelector('.motion-fill');
  updateHTML(list,'<div class="motion-track"><span class="motion-fill p50"></span></div>');
  assert.equal(list.querySelector('.motion-fill'),fill);assert.ok(fill.classList.contains('p50'));
});
