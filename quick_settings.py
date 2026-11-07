"""Validated, portable generation shortcuts stored independently of job settings."""
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, model_validator

from generation_runtime import ImageSettings
from generation_choices import AspectRatio,ImageSize,UpscaleFactor

IMAGE_MODELS = get_args(ImageSettings.model_fields['image_model'].annotation)
VALUES = {
    'ratio': get_args(AspectRatio),
    'size': get_args(ImageSize),
    'stitch': get_args(UpscaleFactor),
    'quality': get_args(ImageSettings.model_fields['quality'].annotation),
    'image_model': IMAGE_MODELS,
    'transport': get_args(ImageSettings.model_fields['transport'].annotation),
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
