from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CarveParams(BaseModel):
    """All machining parameters. Lengths are always in mm; `units` only affects G-code output."""

    model_config = ConfigDict(extra="ignore")

    width_mm:       float = Field(200.0, gt=0)
    height_mm:      float = Field(200.0, gt=0)
    cut_depth:      float = Field(10.0, gt=0)
    wood_thickness: float = Field(18.0, gt=0)
    step_over:      float = Field(0.25, gt=0)
    depth_per_pass: float = Field(1.0, gt=0)

    bit_type:     Literal["vbit", "endmill"] = "vbit"
    bit_diameter: float = Field(3.175, gt=0)
    tip_angle:    float = Field(60.0, gt=0, lt=180)

    spindle_speed: int   = Field(12000, ge=100)
    feed_rate:     float = Field(1000.0, gt=0)
    plunge_rate:   float = Field(300.0, gt=0)
    safe_height:   float = Field(5.0, gt=0)

    units: Literal["metric", "imperial"] = "metric"

    @model_validator(mode="after")
    def _depth_within_stock(self):
        if self.cut_depth > self.wood_thickness:
            raise ValueError("cut_depth must not exceed wood_thickness")
        return self
