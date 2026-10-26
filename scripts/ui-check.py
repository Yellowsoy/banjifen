"""双端 UI 验收：桌面 1440x900 / 手机 390x844，全页面截图 + 控制台错误收集"""
import asyncio, os
from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
OUT = "/tmp/shots"
os.makedirs(OUT, exist_ok=True)

USER = "123456"
PWD = "123456"


async def snap(page, name):
    await page.wait_for_timeout(700)
    await page.screenshot(path=f"{OUT}/{name}.png", full_page=True)
    print("  snap:", name)


async def run(pw, label, viewport):
    print(f"=== {label} ===")
    browser = await pw.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    ctx = await browser.new_context(viewport=viewport, device_scale_factor=1)
    page = await ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(f"[console.{m.type}] {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

    # 1 登录页
    await page.goto(f"{BASE}/login.html", wait_until="networkidle")
    await snap(page, f"{label}-01-login")

    # 2 登录
    await page.fill("#loginUser", USER)
    await page.fill("#loginPwd", PWD)
    await page.click("#btnLogin")
    await page.wait_for_url(lambda u: not u.endswith("/login.html"), timeout=8000)
    await page.wait_for_load_state("networkidle")
    await snap(page, f"{label}-02-home")

    # 3 各 tab
    for view, nm in [("groups", "groups"), ("seat", "seat"), ("mall", "mall")]:
        tab = await page.query_selector(f'.view-tab[data-view="{view}"]')
        if tab and await tab.is_visible():
            await tab.click()
            await snap(page, f"{label}-03-{nm}")

    tabs = await page.query_selector_all(".view-tab")
    for t in tabs:
        v = await t.get_attribute("data-view")
        if v in ("students",):
            await t.click()
            break

    # 4 设置页
    await page.goto(f"{BASE}/settings.html", wait_until="networkidle")
    await snap(page, f"{label}-04-settings-account")
    navs = await page.query_selector_all("#setNav button")
    for b in navs:
        sec = await b.get_attribute("data-section")
        await b.click()
        await snap(page, f"{label}-05-{sec}")

    # 5 溢出检测
    overflow = await page.evaluate(
        """() => { const d=document.documentElement; return {sw:d.scrollWidth, cw:d.clientWidth}; }"""
    )
    await page.goto(BASE, wait_until="networkidle")
    await page.wait_for_timeout(500)
    overflow_home = await page.evaluate(
        """() => { const d=document.documentElement; return {sw:d.scrollWidth, cw:d.clientWidth}; }"""
    )
    await page.goto(f"{BASE}/login.html", wait_until="networkidle")
    overflow_login = await page.evaluate(
        """() => { const d=document.documentElement; return {sw:d.scrollWidth, cw:d.clientWidth}; }"""
    )
    print("  横向溢出设置页:", overflow, "首页:", overflow_home, "登录页:", overflow_login)
    print("  控制台错误数:", len(errors))
    for e in errors[:12]:
        print("   ", e)
    await browser.close()


async def main():
    async with async_playwright() as pw:
        await run(pw, "desktop", {"width": 1440, "height": 900})
        await run(pw, "mobile", {"width": 390, "height": 844})


asyncio.run(main())
