# -*- coding: utf-8 -*-
"""临时脚本：对八个风格世界逐一截图，供视觉复查。"""
from playwright.sync_api import sync_playwright
import os

OUT = os.path.dirname(os.path.abspath(__file__)) + "/genre-shots"
os.makedirs(OUT, exist_ok=True)
WORLDS = ["electronic", "rock-metal", "hiphop", "prism", "folk", "classical", "jazz-soul", "ambient"]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("console", lambda msg: errors.append(f"[{msg.type}] {msg.text}") if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(f"[pageerror] {exc}"))

    page.goto("http://localhost:3000/", wait_until="networkidle", timeout=45000)
    page.wait_for_timeout(3000)
    page.evaluate("typeof dismissSplash === 'function' && dismissSplash({instant:true})")
    page.wait_for_timeout(6000)

    on = page.evaluate("typeof applyGenreMode === 'function' && applyGenreMode(true, {})")
    print("genre mode on:", on)
    page.wait_for_timeout(3500)

    for wid in WORLDS:
        page.evaluate(f"setGenreWorldLock({wid!r})")
        page.wait_for_timeout(3400)  # 2s portal + 渲染稳定
        page.mouse.move(720, 450)    # 唤醒 HUD
        page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}/{wid}.png")
        print("shot:", wid)

    print("=== 渲染错误 ===")
    for e in errors[:30]:
        print(e)
    print(f"共 {len(errors)} 条")
    browser.close()
print("done ->", OUT)
