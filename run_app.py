#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
肘边备急 · 局域网共享启动器
============================================================
把 dist/ 目录用 HTTP 服务起来，同一 WiFi / 同一网段的其他设备
（手机、平板、其他电脑）打开提示的地址即可使用。

设计要点：
  · 只用 Python 标准库，零第三方依赖（扫码是可选增强，装了 qrcode 才启用）
  · 多线程：多台设备同时访问不会互相阻塞
  · 端口被占用时自动往后找可用端口，不会直接崩
  · 列出所有网卡 IP，优先推荐家用网段（192.168 / 10 / 172.16-31）
  · 禁用缓存，改完 dist 刷新就能看到新版

用法：
    python run_app.py                 # 默认 8089
    python run_app.py --port 9000
    python run_app.py --no-open       # 不自动开浏览器
    python run_app.py --host 127.0.0.1  # 仅本机可访问

停止：Ctrl + C
"""

import argparse
import http.server
import os
import socket
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")
DEFAULT_PORT = 8089
PORT_TRIES = 20          # 端口被占时最多往后试这么多个
BANNER_W = 62


# ---------------------------------------------------------------- 终端输出
def _supports_color():
    if os.environ.get("NO_COLOR"):
        return False
    if not sys.stdout.isatty():
        return False
    if os.name == "nt":
        return bool(os.environ.get("WT_SESSION") or os.environ.get("ANSICON")
                    or os.environ.get("ConEmuANSI") == "ON")
    return os.environ.get("TERM", "") not in ("", "dumb")


def box(title, lines):
    print("=" * BANNER_W)
    if title:
        print(title)
        print("-" * BANNER_W)
    for ln in lines:
        print(ln)
    print("=" * BANNER_W)


# ---------------------------------------------------------------- 网卡枚举
def _probe_ip():
    """默认路由探针：UDP connect 不真的发包，但能让内核选出出口 IP。"""
    for target in ("223.5.5.5", "8.8.8.8", "1.1.1.1"):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.settimeout(0.3)
            s.connect((target, 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("0."):
                return ip
        except OSError:
            pass
        finally:
            s.close()
    return None


def _rank(ip):
    """家用/办公常见网段排前面，虚拟网卡排后面。"""
    if ip.startswith("192.168."):
        return 0
    if ip.startswith("10."):
        return 1
    if ip.startswith("172."):
        try:
            if 16 <= int(ip.split(".")[1]) <= 31:
                return 2
        except (ValueError, IndexError):
            pass
    return 3


def lan_ips():
    ips = set()
    probe = _probe_ip()
    if probe:
        ips.add(probe)
    try:
        _, _, addrs = socket.gethostbyname_ex(socket.gethostname())
        ips.update(addrs)
    except OSError:
        pass

    out = []
    for x in ips:
        if not x or x.startswith(("127.", "169.254.", "0.")):
            continue          # 回环 / 链路本地 / 未分配
        out.append(x)

    # 默认路由那条出口 IP 几乎肯定是对的（真 WiFi 网卡），永远排第一；
    # VMnet / WSL / Hyper-V 的虚拟网卡可能也是 192.168.x，不能只按网段排序。
    rest = sorted({x for x in out if x != probe}, key=lambda x: (_rank(x), x))
    return ([probe] if probe in out else []) + rest


# ---------------------------------------------------------------- HTTP 服务
class Handler(http.server.SimpleHTTPRequestHandler):
    """静态文件服务：禁缓存 + 只把错误写日志，避免手机加载时刷屏。"""

    server_version = "ZhoubianbeijiLAN/1.0"
    # HTTP/1.1 支持 keep-alive：手机端一次要取 index + manifest + sw + 图标，
    # 复用连接比每次重连快很多（静态文件都会带 Content-Length，安全）
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST, **kwargs)

    def end_headers(self):
        # 局域网共享时禁用缓存：改完 dist/ 刷新即生效，避免"改了没反应"
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # args = (requestline, code, size)
        code = str(args[1]) if len(args) > 1 else ""
        if code.startswith(("4", "5")):
            sys.stderr.write("  ! %s\n" % (fmt % args))
            sys.stderr.flush()


class ThreadedServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    # ⚠️ Windows 上 SO_REUSEADDR 的语义与 Unix 不同：它允许「两个进程绑同一端口」，
    #    结果是新实例把正在跑的实例的端口悄悄抢走（比报错更危险）。
    #    所以 Windows 下必须关掉地址复用，端口被占才会正常抛错 → 触发向下回退。
    allow_reuse_address = os.name != "nt"
    allow_reuse_port = False


def bind_server(host, want_port):
    """返回 (server, port)；端口被占则自动往后找。"""
    last_err = None
    for port in range(want_port, want_port + PORT_TRIES):
        try:
            srv = ThreadedServer((host, port), Handler)
            return srv, port
        except OSError as exc:
            last_err = exc
            continue
    raise last_err if last_err else OSError("无法绑定端口")


# ---------------------------------------------------------------- 可选扫码
def print_qr(url):
    """装了 qrcode 才打印（纯 Python 包，无需 Pillow）。用 ANSI 背景色保证黑白正确。"""
    try:
        import qrcode
    except ImportError:
        return False
    try:
        qr = qrcode.QRCode(border=2, box_size=1)
        qr.add_data(url)
        qr.make(fit=True)
        m = qr.get_matrix()
    except Exception:
        return False

    use_color = _supports_color()
    print()
    print("  📷 手机扫码直达（微信/相机扫一扫）：")
    print()
    for row in m:
        if use_color:
            print("    " + "".join("\x1b[48;5;0m  \x1b[0m" if c else "\x1b[48;5;15m  \x1b[0m" for c in row))
        else:
            print("    " + "".join("██" if c else "  " for c in row))
    print()
    if not use_color:
        print("    提示：若手机扫不出来，多半是终端把黑白反色了。"
              "改用手机浏览器手动输入上面的网址即可。")
    return True


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser(
        description="肘边备急 · 局域网共享启动器（把 dist/ 共享给同网段设备）")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT,
                    help=f"监听端口，默认 {DEFAULT_PORT}；被占用会自动往后找")
    ap.add_argument("--host", default="0.0.0.0",
                    help="监听地址，默认 0.0.0.0（局域网可访问）；填 127.0.0.1 则仅本机")
    ap.add_argument("--no-open", action="store_true", help="不自动打开本机浏览器")
    ap.add_argument("--no-qr", action="store_true", help="不打印扫码图案")
    args = ap.parse_args()

    index = os.path.join(DIST, "index.html")
    if not os.path.isfile(index):
        box("❌ 找不到构建产物", [
            "",
            f"  期望路径：{index}",
            "",
            "  解决办法（在项目根目录执行）：",
            "      node build.js",
            "",
            "  或者直接用已发布的在线版：",
            "      https://drdentist-hub.github.io/dental-insurance-calc/",
        ])
        return 2

    try:
        srv, port = bind_server(args.host, args.port)
    except OSError as exc:
        box("❌ 无法启动服务", [
            "",
            f"  监听 {args.host} 失败：{exc}",
            "",
            f"  已尝试端口 {args.port} ~ {args.port + PORT_TRIES - 1}，全部被占用。",
            "  可换个端口重试：  python run_app.py --port 9000",
        ])
        return 1

    local_url = f"http://localhost:{port}"
    ips = lan_ips() if args.host in ("0.0.0.0", "") else []
    size_kb = os.path.getsize(index) / 1024

    lines = [
        "",
        "  💻 本机访问（自动打开）",
        f"     {local_url}",
        "",
    ]
    if ips:
        lines.append("  📱 手机 / 平板 / 其他电脑访问（需同一 WiFi 或同一网段）")
        for i, ip in enumerate(ips):
            tag = "  ← 优先试这个" if i == 0 else ""
            lines.append(f"     http://{ip}:{port}{tag}")
        if len(ips) > 1:
            lines.append("     （有多块网卡时逐个试，能打开的那个就是对的）")
    else:
        lines.append("  🔒 当前仅本机可访问（--host 绑定的是回环地址）")

    lines += [
        "",
        f"  产物：dist/index.html · {size_kb:.0f} KB · 单文件离线版",
        "",
        "  ⚠️ 两点说明",
        "     · 局域网是 http:// 非加密地址，浏览器不会注册 Service Worker，",
        "       所以「添加到主屏幕」只是快捷方式，不会离线缓存；",
        "       功能本身完全正常（应用零网络请求，数据只留在这台电脑的浏览器里）。",
        "       想要真正的 PWA 离线安装，用 HTTPS 的在线版或装 APK。",
        "     · 若手机打不开：多为 Windows 防火墙拦截，首次运行请允许",
        "       Python 的「专用网络」访问；公共 WiFi 下建议不要开放。",
        "",
        "  停止服务：Ctrl + C",
        "",
    ]
    box("🦷 肘边备急 · 局域网共享已启动", lines)

    if not args.no_qr and ips:
        if not print_qr(f"http://{ips[0]}:{port}"):
            print("  （未安装 qrcode 模块，跳过扫码图；"
                  "想启用：pip install qrcode）\n")

    if not args.no_open:
        try:
            webbrowser.open(local_url)
        except Exception:
            pass

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  正在停止…")
    finally:
        srv.shutdown()
        srv.server_close()
        print("  服务已关闭。数据仍在浏览器本地，未上传任何地方。")
    return 0


if __name__ == "__main__":
    # Windows 下 Ctrl+C 偶尔会在 serve_forever 里抛 KeyboardInterrupt 之外的异常
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
