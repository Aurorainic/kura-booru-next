"""AI tag classification and translation service.

Calls an OpenAI-compatible API to classify tags into Danbooru categories
(artist/character/copyright/general/meta), provide danbooru_name,
and generate Chinese translations.
"""

import json
import logging
from datetime import datetime

from openai import AsyncOpenAI

from app.config import settings
from app.models.tag import TagCategory

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
你是一位二次元插画标签分类与翻译专家。请对输入的标签列表进行分析。

## 分类标准（5类）

1. **artist** - 画师的署名、笔名、Pixiv/Twitter ID
   - 例：lack, モ誰, ask_(askzy), mocha_(mochamoca)
   - 注意：Pixiv 用户外显名如果像人名/笔名，归入此类

2. **character** - 动漫、游戏、VTuber 角色名
   - 例：hatsune_miku, ganyu_(genshin_impact), 猫又おかゆ
   - 注意：原创角色(OC)无特定名称的不归入此类

3. **copyright** - 作品、IP、游戏、动画、漫画名称
   - 例：vocaloid, fate_grand_order, pokemon, original
   - 注意：原创插画标记为 "original"

4. **general** - 描述画面内容的普通标签
   - 包括：外貌特征(发色/瞳色/服装)、动作、场景、物品、情绪
   - 例：long_hair, blue_eyes, school_uniform, smile

5. **meta** - 与画面内容无关的元信息
   - 例：1000users入り, translated, highres, commentary_request

## 处理规则

- 输入标签保持原样，不要修改命名（如不要空格改下划线）
- 对每个标签判断最可能的分类
- 提供简体中文翻译：
  - 角色名使用中文圈通用译名（Bilibili/萌娘百科/维基百科标准）
  - 画师名一般不翻译（保留原文）
  - 描述性标签翻译为自然中文
  - 作品名使用官方中文译名（如有）
  - meta 标签可不翻译或直译

## 输出格式

严格返回 JSON，不要 markdown 代码块：

{
  "tags": [
    {
      "name": "原始标签名（完全不变）",
      "type": "artist|character|copyright|general|meta",
      "translation": "中文翻译（无则空字符串）",
      "danbooru_name": "Danbooru标准命名（小写+下划线）"
    }
  ]
}
"""

VALID_CATEGORIES = {c.value for c in TagCategory}


def _get_client() -> AsyncOpenAI:
    """Create an AsyncOpenAI client from project settings."""
    return AsyncOpenAI(
        api_key=settings.AI_PROVIDER_API_KEY,
        base_url=settings.AI_PROVIDER_ENDPOINT,
    )


def _build_user_prompt(tag_names: list[str]) -> str:
    """Build the user prompt with tag names."""
    lines = "\n".join(f"- {name}" for name in tag_names)
    return f"请对以下标签进行分类和翻译：\n{lines}"


def parse_ai_response(raw: str) -> list[dict]:
    """Parse and validate the AI JSON response.

    Returns a list of dicts with keys: name, type, translation, danbooru_name.
    Raises ValueError on invalid format.
    """
    # Strip markdown code fences if present
    text = raw.strip()
    if text.startswith("```"):
        # Remove opening fence (```json or ```)
        first_newline = text.index("\n")
        text = text[first_newline + 1 :]
        # Remove closing fence
        if text.endswith("```"):
            text = text[: -len("```")]
        text = text.strip()

    data = json.loads(text)

    if "tags" not in data or not isinstance(data["tags"], list):
        raise ValueError("AI response missing 'tags' array")

    results = []
    for item in data["tags"]:
        name = item.get("name", "")
        tag_type = item.get("type", "general")
        translation = item.get("translation", "")
        danbooru_name = item.get("danbooru_name", "")

        # Validate category
        if tag_type not in VALID_CATEGORIES:
            logger.warning(
                "AI returned invalid category '%s' for tag '%s', defaulting to general",
                tag_type,
                name,
            )
            tag_type = "general"

        results.append(
            {
                "name": name,
                "type": tag_type,
                "translation": translation,
                "danbooru_name": danbooru_name,
            }
        )

    return results


async def classify_tags(tag_names: list[str]) -> list[dict]:
    """Classify a list of tag names using the AI provider.

    Args:
        tag_names: List of raw tag name strings.

    Returns:
        List of dicts with keys: name, type, translation, danbooru_name.

    Raises:
        ValueError: If AI response cannot be parsed.
        RuntimeError: If AI provider is not configured.
    """
    if not settings.ENABLE_AI_TAG_PROCESSING:
        raise RuntimeError("AI tag processing is disabled")

    if not settings.AI_PROVIDER_API_KEY or not settings.AI_PROVIDER_ENDPOINT:
        raise RuntimeError("AI provider not configured (missing API key or endpoint)")

    client = _get_client()
    user_prompt = _build_user_prompt(tag_names)

    response = await client.chat.completions.create(
        model=settings.AI_PROVIDER_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.1,  # Low temperature for deterministic classification
        response_format={"type": "json_object"},
    )

    raw_content = response.choices[0].message.content
    if not raw_content:
        raise ValueError("AI returned empty response")

    return parse_ai_response(raw_content)
