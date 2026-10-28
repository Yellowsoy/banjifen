"""双端截图生成：13 个视图 × 桌面(1440x900) / 手机(390x844)，使用虚构演示数据。
依赖：先 `npm start` 启动服务，再 `node scripts/seed-demo.js` 灌入虚构数据。
用法：python3 scripts/shoot.py
输出：docs/screenshots/desktop/* 与 docs/screenshots/mobile/*
"""
import asyncio, os
from playwright.async_api import async_playwright

BASE = "http://localhost:3000"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "screenshots")
DESKTOP = {"width": 1440, "height": 900}
MOBILE = {"width": 390, "height": 844}

# 13 个视图的文件名（桌面/手机共用）
NAMES = [
    "01-login", "02-ranking", "03-points", "04-groups", "05-seat",
    "06-mall", "07-scores", "08-student-report", "09-members",
    "10-cadre-view", "11-super-classes", "12-super-accounts", "13-super-logs",
]

PAGE_WAIT = 800


async def snap(page, path, full=True):
    await page.wait_for_timeout(PAGE_WAIT)
    await page.screenshot(path=path, full_page=full)
    print("  ✔", os.path.relpath(path, ROOT))


async def click_text(page, scope, text):
    """在 scope 选择器内点击包含 text 的元素"""
    try:
        await page.locator(scope, has_text=text).first.click(timeout=4000)
        return True
    except Exception as e:
        print(f"    ! 点击 [{text}] 失败: {e}")
        return False


async def owner_flow(page, label):
    # 登录页
    await page.goto(f"{BASE}/login.html", wait_until="networkidle")
    await snap(page, f"{OUT}/{label}/{NAMES[0]}.png")

    # 登录（班主任）
    await page.fill("#loginUser", "123456")
    await page.fill("#loginPwd", "123456")
    await page.click("#btnLogin")
    await page.wait_for_selector("#classScreen:not(.hidden)", timeout=12000)
    await page.wait_for_timeout(PAGE_WAIT)

    # 学生榜（默认高→低 = 积分排行榜）
    await snap(page, f"{OUT}/{label}/{NAMES[1]}.png")

    # 加减分操作（点首个学生「加分」打开弹窗）
    try:
        await page.locator('#studentList [data-act="add"]').first.click(timeout=4000)
        await page.wait_for_selector("#modalRoot .modal", timeout=5000)
        await page.wait_for_timeout(600)
    except Exception as e:
        print(f"    ! 加分弹窗失败: {e}")
    await snap(page, f"{OUT}/{label}/{NAMES[2]}.png", full=False)
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(300)

    # 小组管理
    await page.locator('[data-view="groups"]').click(timeout=4000)
    await page.wait_for_timeout(PAGE_WAIT)
    await snap(page, f"{OUT}/{label}/{NAMES[3]}.png")

    # 积分排座
    await page.locator('[data-view="seat"]').click(timeout=4000)
    await page.wait_for_timeout(PAGE_WAIT)
    await snap(page, f"{OUT}/{label}/{NAMES[4]}.png")

    # 积分商城
    await page.locator('[data-view="mall"]').click(timeout=4000)
    await page.wait_for_timeout(PAGE_WAIT)
    await snap(page, f"{OUT}/{label}/{NAMES[5]}.png")

    # 成绩分析（点击「成绩」视图标签）
    await page.locator('[data-view="scores"]').click(timeout=4000)
    await page.wait_for_timeout(1000)
    await snap(page, f"{OUT}/{label}/{NAMES[6]}.png")

    # 学生档案（点首个学生「编辑」打开完整档案弹窗）
    await page.locator('[data-view="students"]').click(timeout=4000)
    await page.wait_for_timeout(500)
    try:
        await page.locator('#studentList [data-act="edit"]').first.click(timeout=4000)
        await page.wait_for_selector("#modalRoot .modal", timeout=5000)
        await page.wait_for_timeout(600)
    except Exception as e:
        print(f"    ! 学生档案弹窗失败: {e}")
    await snap(page, f"{OUT}/{label}/{NAMES[7]}.png", full=False)
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(300)

    # 成员管理（设置页独立 URL）
    await page.goto(f"{BASE}/settings.html", wait_until="networkidle")
    await page.wait_for_timeout(PAGE_WAIT)
    await click_text(page, "#setNav button", "成员管理")
    await page.wait_for_timeout(PAGE_WAIT)
    await snap(page, f"{OUT}/{label}/{NAMES[8]}.png")


async def cadre_flow(page, label):
    await page.goto(f"{BASE}/login.html", wait_until="networkidle")
    await page.fill("#loginUser", "cadre")
    await page.fill("#loginPwd", "123456")
    await page.click("#btnLogin")
    await page.wait_for_selector("#classScreen:not(.hidden)", timeout=12000)
    await page.wait_for_timeout(1000)
    await snap(page, f"{OUT}/{label}/{NAMES[9]}.png")


async def super_flow(page, label):
    await page.goto(f"{BASE}/login.html", wait_until="networkidle")
    await page.fill("#loginUser", "admin")
    await page.fill("#loginPwd", "admin123456")
    await page.click("#btnLogin")
    await page.wait_for_selector("#superScreen:not(.hidden)", timeout=12000)
    await page.wait_for_timeout(1000)
    await snap(page, f"{OUT}/{label}/{NAMES[10]}.png")

    await click_text(page, "#superTabs .pill", "全部账号")
    await page.wait_for_timeout(PAGE_WAIT)
    await snap(page, f"{OUT}/{label}/{NAMES[11]}.png")

    await click_text(page, "#superTabs .pill", "操作日志")
    await page.wait_for_timeout(PAGE_WAIT)
    await snap(page, f"{OUT}/{label}/{NAMES[12]}.png")


async def run_label(pw, label, viewport):
    print(f"\n=== {label} ({viewport['width']}x{viewport['height']}) ===")
    browser = await pw.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
    for flow, role in [(owner_flow, "班主任"), (cadre_flow, "班干部"), (super_flow, "超管")]:
        ctx = await browser.new_context(viewport=viewport, device_scale_factor=1)
        page = await ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(f"[console.{m.type}] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
        try:
            await flow(page, label)
        except Exception as e:
            print(f"  ✗ {role} 流程异常: {e}")
        if errors:
            print(f"  ⚠ {role} 控制台错误({len(errors)}):", errors[:5])
        await ctx.close()
    await browser.close()


async def main():
    os.makedirs(f"{OUT}/desktop", exist_ok=True)
    os.makedirs(f"{OUT}/mobile", exist_ok=True)
    async with async_playwright() as pw:
        await run_label(pw, "desktop", DESKTOP)
        await run_label(pw, "mobile", MOBILE)
    print("\n完成。")


asyncio.run(main())
