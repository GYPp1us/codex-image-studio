import json
import unittest
from prompt_capture import extract


class PromptCaptureTests(unittest.TestCase):
    def test_explicit_worker_report_preserves_multiline_prompt(self):
        event={'item':{'type':'agent_message','text':'<STUDIO_POLISHED_PROMPT>\nA warm garden.\nKeep {braces} and 中文.\n</STUDIO_POLISHED_PROMPT>'}}
        self.assertEqual(extract(event),('A warm garden.\nKeep {braces} and 中文.','worker_report'))

    def test_structured_tool_arguments_are_preferred_evidence(self):
        for arguments in ({'prompt':'Exact tool prompt'},json.dumps({'prompt':'Exact tool prompt'})):
            self.assertEqual(extract({'item':{'type':'mcp_tool_call','tool':'image_gen.imagegen','arguments':arguments}}),('Exact tool prompt','tool_arguments'))

    def test_missing_or_ordinary_text_is_not_invented_as_polished_prompt(self):
        for event in ({},{'item':{'type':'agent_message','text':'Image saved successfully'}},
                      {'item':{'type':'agent_message','text':'[STUDIO_STAGE:receiving]'}},
                      {'item':{'type':'tool_call','tool':'shell','arguments':{'prompt':'not an image prompt'}}}):
            self.assertIsNone(extract(event))


if __name__=='__main__':unittest.main()
