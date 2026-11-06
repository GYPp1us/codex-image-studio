"""Validated, portable generation shortcuts stored independently of job settings."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, model_validator

IMAGE_MODELS = ('gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare',
                'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare')
VALUES = {
    'ratio': ('1:1', '3:2', '2:3', '16:9', '9:16', 'auto'),
    'size': ('auto', '1024', '2048', '4096'),
    'stitch': (0, 4, 16, 64),
    'quality': ('auto', 'low', 'medium', 'high', 'xhigh', 'max'),
    'image_model': IMAGE_MODELS,
    'transport': ('images', 'responses', 'cli'),
    'polish': ('toggle',), 'transparent': ('toggle',), 'fallback': ('toggle',),
}


class QuickSetting(BaseModel):
    model_config = ConfigDict(extra='forbid')
    key: Literal['ratio', 'size', 'count', 'stitch', 'polish', 'transparent',
                 'model', 'effort', 'image_model', 'quality', 'transport', 'partial_images', 'fallback']
    value: StrictStr | StrictInt
    label: str = Field(default='', max_length=40)

    @model_validator(mode='after')
    def validate_value(self):
        if self.key in VALUES and self.value not in VALUES[self.key]:
            raise ValueError('不支持的快速设置值')
        if self.key in ('count', 'partial_images'):
            minimum, maximum = (1, 20) if self.key == 'count' else (0, 3)
            if type(self.value) is not int or not minimum <= self.value <= maximum:
                raise ValueError('快速设置数值超出范围')
        if self.key in ('model', 'effort'):
            if not isinstance(self.value, str) or not 1 <= len(self.value) <= 100:
                raise ValueError('模型或思考强度无效')
        self.label = self.label.strip()
        return self
