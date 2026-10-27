"""Capture explicitly reported polished prompts; never reconstruct old job logs."""
from __future__ import annotations

import json
import re

REPORT_INSTRUCTION='''Polished prompt reporting: Before invoking image generation, emit one separate message containing <STUDIO_POLISHED_PROMPT>, then the exact complete prompt you will send to the image-generation tool, then </STUDIO_POLISHED_PROMPT>. Do not put the markers into the image-generation prompt. Keep the original user brief unchanged in the task record. Do not include credentials or environment details in this report.'''


def extract(event):
    item=event.get('item') or {}
    if not isinstance(item,dict):return None
    name=str(item.get('tool') or item.get('name') or '')
    if item.get('type') in ('mcp_tool_call','tool_call','image_generation') and (item.get('type')=='image_generation' or re.search(r'image_?gen',name,re.I)):
        arguments=item.get('arguments',item.get('input'))
        if isinstance(arguments,str):
            try:arguments=json.loads(arguments)
            except ValueError:arguments=None
        if isinstance(arguments,dict) and isinstance(arguments.get('prompt'),str) and arguments['prompt'].strip():
            return arguments['prompt'][:120000],'tool_arguments'
    if item.get('type')=='agent_message' and isinstance(item.get('text'),str):
        match=re.search(r'<STUDIO_POLISHED_PROMPT>\s*([\s\S]*?)\s*</STUDIO_POLISHED_PROMPT>',item['text'])
        if match and match.group(1).strip():return match.group(1).strip()[:120000],'worker_report'
    return None
