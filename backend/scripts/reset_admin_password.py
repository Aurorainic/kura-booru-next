#!/usr/bin/env python3
"""
Reset the admin password to the value configured in ADMIN_PASSWORD env var.

Usage:
    python scripts/reset_admin_password.py

This script:
1. Reads ADMIN_USERNAME and ADMIN_PASSWORD from environment
2. Updates the existing admin's password hash, or creates a new admin if none exists
"""

import asyncio
import os
import sys

import bcrypt
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

# Add parent directory to path so we can import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models.admin import Admin


async def main():
    db_url = os.getenv("DATABASE_URL")
    username = os.getenv("ADMIN_USERNAME", "admin")
    password = os.getenv("ADMIN_PASSWORD")

    if not password:
        print("ERROR: ADMIN_PASSWORD environment variable is not set")
        print("Set it in .env or export it before running this script")
        sys.exit(1)

    print(f"Database: {db_url[:50]}...")
    print(f"Username: {username}")
    print(f"Password: {password}")

    engine = create_async_engine(db_url)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Check if admin exists
        result = await session.execute(
            select(Admin).where(Admin.username == username)
        )
        admin = result.scalar_one_or_none()

        # Hash the password
        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

        if admin:
            # Update existing admin
            admin.password_hash = hashed
            session.add(admin)
            await session.commit()
            print(f"✓ Updated password for existing admin '{username}'")
        else:
            # Create new admin
            admin = Admin(username=username, password_hash=hashed)
            session.add(admin)
            await session.commit()
            print(f"✓ Created new admin '{username}'")

    await engine.dispose()
    print("Done! You can now login with the configured credentials.")


if __name__ == "__main__":
    asyncio.run(main())
