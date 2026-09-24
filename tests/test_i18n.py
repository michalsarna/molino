import json
import re
from pathlib import Path

STATIC = Path(__file__).resolve().parents[1] / "app" / "static"
I18N = STATIC / "i18n"


def load(code):
    return json.loads((I18N / f"{code}.json").read_text(encoding="utf-8"))


def test_every_language_has_the_same_keys_and_placeholders():
    en = load("en")
    files = sorted(I18N.glob("*.json"))
    assert {f.stem for f in files} >= {"en", "pl", "de"}
    for f in files:
        d = load(f.stem)
        assert set(d) == set(en), f"{f.stem}: {set(d) ^ set(en)}"
        for key, text in en.items():
            assert set(re.findall(r"\{(\w+)\}", text)) == set(re.findall(r"\{(\w+)\}", d[key])), (f.stem, key)
            assert d[key].strip(), (f.stem, key)


def test_markup_and_script_reference_only_known_keys():
    en = set(load("en"))
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    html_keys = set(re.findall(r'data-i18n(?:-html|-title)?="([^"]+)"', html))
    assert html_keys and html_keys <= en, html_keys - en

    js = (STATIC / "app.js").read_text(encoding="utf-8")
    js_keys = set(re.findall(r'\bt\("([^"]+)"', js))
    assert js_keys and js_keys <= en, js_keys - en

    # every dynamic key family used in JS has entries
    assert {f"origin.{o}" for o in ("top-left", "middle-center", "bottom-right")} <= en
    assert {"tool.vbit", "tool.endmill", "tool.ballnose"} <= en
