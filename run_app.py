import http.server
import socketserver
import webbrowser
import os
import socket

PORT = 8089
DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

if __name__ == '__main__':
    local_ip = get_local_ip()
    local_url = f"http://localhost:{PORT}"
    mobile_url = f"http://{local_ip}:{PORT}"

    print("=" * 60)
    print("🦷 肘边备急 · 口腔门诊医保精算与合规风控系统已启动！")
    print("   开源项目 · GNU GPL-3.0 · 零第三方依赖 · 数据不出本机")
    print(f"💻 电脑端访问网址: {local_url}")
    print(f"📱 安卓手机访问网址 (同WiFi局域网): {mobile_url}")
    print("👉 手机端使用提示: 打开上述手机网址后，点击浏览器菜单「添加至主屏幕」，")
    print("   即可生成手机桌面 App 独立图标，支持断网离线全屏运行！")
    print("=" * 60)

    # 自动在默认浏览器打开
    try:
        webbrowser.open(local_url)
    except Exception:
        pass

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务已平稳关闭。")
