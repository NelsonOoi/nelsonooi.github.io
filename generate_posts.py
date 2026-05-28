#!/usr/bin/env python3
"""Scan posts/*.md frontmatter and write posts/posts.json."""

import json, os, re

POSTS_DIR = os.path.join(os.path.dirname(__file__) or ".", "posts")
FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)
FIELD_RE = re.compile(r"^(\w+):\s*(.+)$", re.MULTILINE)

posts = []
for fname in os.listdir(POSTS_DIR):
    if not fname.endswith(".md"):
        continue
    with open(os.path.join(POSTS_DIR, fname)) as f:
        text = f.read()
    m = FRONTMATTER_RE.match(text)
    if not m:
        continue
    fields = dict(FIELD_RE.findall(m.group(1)))
    fields["slug"] = fname[:-3]
    posts.append(fields)

posts.sort(key=lambda p: p.get("date", ""), reverse=True)

with open(os.path.join(POSTS_DIR, "posts.json"), "w") as f:
    json.dump(posts, f, indent=2)

print(f"Wrote {len(posts)} post(s) to posts/posts.json")
