"""REST API routes for auto-rating rules.

Provides CRUD for tag-based auto-rating rules (admin only).
Rules map a tag name to a target rating. When a post is created
with a matching tag, the post's rating is automatically escalated.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_admin
from app.database import get_db
from app.models.admin import Admin
from app.models.auto_rating_rule import AutoRatingRule
from app.models.post import Rating

router = APIRouter()


class AutoRatingRuleCreate(BaseModel):
    """Request body for creating an auto-rating rule."""

    tag_name: str
    target_rating: Rating


class AutoRatingRuleRead(BaseModel):
    """Schema for reading an auto-rating rule."""

    id: uuid.UUID
    tag_name: str
    target_rating: Rating
    created_at: str

    model_config = {"from_attributes": True}


@router.get("/", response_model=list[AutoRatingRuleRead])
async def list_rules(
    db: AsyncSession = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    """List all auto-rating rules. Admin only."""
    result = await db.execute(
        select(AutoRatingRule).order_by(AutoRatingRule.tag_name)
    )
    rules = result.scalars().all()
    return [
        AutoRatingRuleRead(
            id=rule.id,
            tag_name=rule.tag_name,
            target_rating=rule.target_rating,
            created_at=rule.created_at.isoformat(),
        )
        for rule in rules
    ]


@router.post("/", response_model=AutoRatingRuleRead, status_code=201)
async def create_rule(
    body: AutoRatingRuleCreate,
    db: AsyncSession = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    """Create a new auto-rating rule. Admin only.

    Maps a tag name to a target rating. If the tag already has a rule,
    returns 409.
    """
    # Check for existing rule
    existing = await db.execute(
        select(AutoRatingRule).where(
            AutoRatingRule.tag_name == body.tag_name.strip().lower()
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Rule for tag '{body.tag_name}' already exists",
        )

    rule = AutoRatingRule(
        tag_name=body.tag_name.strip().lower(),
        target_rating=body.target_rating,
    )
    db.add(rule)
    await db.flush()
    await db.refresh(rule)

    return AutoRatingRuleRead(
        id=rule.id,
        tag_name=rule.tag_name,
        target_rating=rule.target_rating,
        created_at=rule.created_at.isoformat(),
    )


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    """Delete an auto-rating rule. Admin only."""
    result = await db.execute(
        select(AutoRatingRule).where(AutoRatingRule.id == rule_id)
    )
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.delete(rule)
    return None
