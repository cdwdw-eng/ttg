import { connect } from "cloudflare:sockets";

// 配置区块
let 订阅路径 = "订阅路径";
let 伪装网页;
let 验证UUID;
let 反代IP = "proxyip.cmliussss.net";

// === 新增：优选IP相关 ===
let 优选IP列表 = [];
let 优选IP最后加载时间 = 0;
const 优选IP缓存时间 = 300 * 1000; // 5 分钟缓存

// === GitHub 默认 URL (不需要环境变量) ===
const DEFAULT_IP_URLS = [
  "https://raw.githubusercontent.com/cdwdw-eng/ttg/main/best-ips.txt",
  // 备用: GitHub Pages 镜像
  "https://cdwdw-eng.github.io/ttg/best-ips.txt",
];

const 默认优选 = "time.is";

// 关键词拆分(防检测)
const 威图锐拆分 = ["v2", "ray"];
const 科拉什拆分 = ["cla", "sh"];
const 维列斯拆分 = ["vl", "ess"];

const 威图锐 = 威图锐拆分.join("");
const 科拉什 = 科拉什拆分.join("");
const 维列斯 = 维列斯拆分.join("");

// 转换密钥格式
const 转换密钥格式 = Array.from({ length: 256 }, (_, i) => (i + 256).toString(16).slice(1));

// === 新增：从外部 TXT 文件加载优选IP ===
async function 加载优选IP(env) {
  // 检查缓存是否过期
  const now = Date.now();
  if (优选IP列表.length > 0 && (now - 优选IP最后加载时间) < 优选IP缓存时间) {
    return; // 缓存有效
  }

  // 从 env.IP_FILE_URL 读取，否则用默认的 GitHub URL
  const IP_FILE_URL = env.IP_FILE_URL || DEFAULT_IP_URLS[0];

  try {
    console.log(`[优选IP] 从 ${IP_FILE_URL} 加载...`);
    const response = await fetch(IP_FILE_URL, {
      cf: { cacheTtl: 0 }, // 绕过 CF 缓存，强制刷新
      headers: { 'User-Agent': 'CF-Pages-Worker/1.0' }
    });

    if (!response.ok) {
      console.log(`[优选IP] HTTP ${response.status} 失败`);
      return;
    }

    const text = await response.text();
    // 解析 TXT 文件：每行一个 IP[:PORT]
    优选IP列表 = text.split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')) // 过滤空行和注释
      .map(line => {
        // 支持格式：IP, IP:PORT, domain:PORT
        const parts = line.split(':');
        if (parts.length === 1) {
          return { hostname: parts[0], port: 443 };
        } else if (parts.length === 2) {
          return { hostname: parts[0], port: parseInt(parts[1]) };
        }
        return null;
      })
      .filter(Boolean);

    优选IP最后加载时间 = now;
    console.log(`[优选IP] 成功加载 ${优选IP列表.length} 个 IP`);
  } catch (e) {
    console.log(`[优选IP] 加载失败: ${e.message}`);
  }
}

// === 新增：随机选一个反代 IP ===
function 选择反代IP() {
  if (优选IP列表.length === 0) {
    // 回退到默认反代IP
    const [ip, port = 443] = 反代IP.split(":");
    return { hostname: ip, port: parseInt(port) };
  }
  // 随机选一个优选 IP
  return 优选IP列表[Math.floor(Math.random() * 优选IP列表.length)];
}

// 网页入口
export default {
  async fetch(访问请求, env, ctx) {
    订阅路径 = env.SUB_PATH ?? 订阅路径;
    验证UUID = 生成UUID();
    反代IP = env.PROXY_IP ?? 反代IP;
    伪装网页 = env.FAKE_WEB;

    // === 新增：异步加载优选 IP ===
    ctx.waitUntil(加载优选IP(env));

    const url = new URL(访问请求.url);
    const 读取我的请求标头 = 访问请求.headers.get("Upgrade");
    const WS请求 = 读取我的请求标头 == "websocket";

    const 路径配置 = {
      威图锐: `/${encodeURI(订阅路径)}/${威图锐}`,
      科拉什: `/${encodeURI(订阅路径)}/${科拉什}`,
      订阅聚合: `/${encodeURI(订阅路径)}/info`,
      通用订阅: `/${encodeURI(订阅路径)}`,
    };

    const 是正确路径 = url.pathname === 路径配置.威图锐 ||
                      url.pathname === 路径配置.科拉什 ||
                      url.pathname === 路径配置.订阅聚合 ||
                      url.pathname === `/${encodeURI(订阅路径)}`

    if (!WS请求 && !是正确路径) {
      if (伪装网页) {
        try {
          const targetBase = 伪装网页.startsWith('http://') || 伪装网页.startsWith('https://')
            ? 伪装网页
            : `https://${伪装网页}`;

          const targetUrl = new URL(targetBase);
          targetUrl.pathname = url.pathname;
          targetUrl.search = url.search;

          const 请求对象 = new Request(targetUrl.toString(), {
            method: 访问请求.method,
            headers: 访问请求.headers,
            body: 访问请求.body,
          });

          const 响应对象 = await fetch(请求对象);
          return 响应对象;
        } catch {
          console.error(`[伪装网页请求失败] 目标: ${伪装网页}`);
          return new Response(null, { status: 404 });
        }
      } else {
        return new Response(null, { status: 404 });
      }
    }

    if (!WS请求) {
      if (url.pathname === 路径配置.威图锐) {
        return 威图锐配置文件(访问请求.headers.get("Host"));
      }
      else if (url.pathname === 路径配置.科拉什) {
        return 科拉什配置文件(访问请求.headers.get("Host"));
      }
      else if (url.pathname === 路径配置.订阅聚合) {
        return 聚合信息(访问请求.headers.get("Host"));
      }
      else if (url.pathname === 路径配置.通用订阅) {
        const 用户代理 = 访问请求.headers.get("User-Agent").toLowerCase();
        const 配置生成器 = {
          [威图锐]: 威图锐配置文件,
          [科拉什]: 科拉什配置文件,
          tips: 提示界面,
        };
        const 工具 = Object.keys(配置生成器).find((工具) => 用户代理.includes(工具));
        const 生成配置 = 配置生成器[工具 || "tips"];
        return 生成配置(访问请求.headers.get("Host"));
      }
    }

    if (WS请求) {
      return await 升级WS请求();
    }
  },
};

// 脚本主要架构
async function 升级WS请求() {
  const [客户端, WS接口] = Object.values(new WebSocketPair());
  WS接口.accept();
  WS接口.binaryType = "arraybuffer";
  WS接口.send(new Uint8Array([0, 0]));
  启动传输管道(WS接口);
  return new Response(null, { status: 101, webSocket: 客户端 });
}

async function 启动传输管道(WS接口) {
  let TCP接口;
  let 首包数据 = true;
  let 处理队列 = Promise.resolve();
  let 传输数据;

  WS接口.addEventListener("message", (event) => {
    处理队列 = 处理队列.then(async () => {
      if (首包数据) {
        首包数据 = false;
        await 解析VL标头(event.data);
      } else {
        await 传输数据.write(event.data);
      }
    });
  });

  async function 解析VL标头(VL数据) {
    if (验证VL的密钥(new Uint8Array(VL数据.slice(1, 17))) !== 验证UUID) {
      return;
    }

    const 获取数据定位 = new Uint8Array(VL数据)[17];
    const 提取端口索引 = 18 + 获取数据定位 + 1;
    const 建立端口缓存 = VL数据.slice(提取端口索引, 提取端口索引 + 2);
    const 访问端口 = new DataView(建立端口缓存).getUint16(0);

    const 提取地址索引 = 提取端口索引 + 2;
    const 建立地址缓存 = new Uint8Array(VL数据.slice(提取地址索引, 提取地址索引 + 1));
    const 识别地址类型 = 建立地址缓存[0];

    let 地址长度 = 0;
    let 访问地址 = "";
    let 地址信息索引 = 提取地址索引 + 1;

    switch (识别地址类型) {
      case 1:
        地址长度 = 4;
        访问地址 = new Uint8Array(VL数据.slice(地址信息索引, 地址信息索引 + 地址长度)).join(".");
        break;
      case 2:
        地址长度 = new Uint8Array(VL数据.slice(地址信息索引, 地址信息索引 + 1))[0];
        地址信息索引 += 1;
        访问地址 = new TextDecoder().decode(VL数据.slice(地址信息索引, 地址信息索引 + 地址长度));
        break;
      case 3:
        地址长度 = 16;
        const dataView = new DataView(VL数据.slice(地址信息索引, 地址信息索引 + 地址长度));
        const ipv6 = [];
        for (let i = 0; i < 8; i++) {
          ipv6.push(dataView.getUint16(i * 2).toString(16));
        }
        访问地址 = ipv6.join(":");
        break;
      default:
        return;
    }

    const 写入初始数据 = VL数据.slice(地址信息索引 + 地址长度);

    try {
      TCP接口 = connect({ hostname: 访问地址, port: 访问端口 });
      await TCP接口.opened;
    } catch {
      // === 修改：使用优选IP列表随机选择反代 ===
      const { hostname, port } = 选择反代IP();
      console.log(`[反代] 失败，目标 ${访问地址}:${访问端口} 不可达，使用反代 ${hostname}:${port}`);
      TCP接口 = connect({ hostname, port });
      await TCP接口.opened;
    }

    建立传输管道(写入初始数据);
  }

  function 验证VL的密钥(arr, offset = 0) {
    const uuid = (转换密钥格式[arr[offset + 0]] + 转换密钥格式[arr[offset + 1]] + 转换密钥格式[arr[offset + 2]] + 转换密钥格式[arr[offset + 3]] + "-" + 转换密钥格式[arr[offset + 4]] + 转换密钥格式[arr[offset + 5]] + "-" + 转换密钥格式[arr[offset + 6]] + 转换密钥格式[arr[offset + 7]] + "-" + 转换密钥格式[arr[offset + 8]] + 转换密钥格式[arr[offset + 9]] + "-" + 转换密钥格式[arr[offset + 10]] + 转换密钥格式[arr[offset + 11]] + 转换密钥格式[arr[offset + 12]] + 转换密钥格式[arr[offset + 13]] + 转换密钥格式[arr[offset + 14]] + 转换密钥格式[arr[offset + 15]]).toLowerCase();
    return uuid;
  }

  async function 建立传输管道(写入初始数据) {
    传输数据 = TCP接口.writable.getWriter();

    if (写入初始数据?.byteLength > 0) {
      await 传输数据.write(写入初始数据);
    }

    TCP接口.readable.pipeTo(
      new WritableStream({
        write(chunk) {
          WS接口.send(chunk);
        },
      })
    );
  }
}

// UUID生成函数
function 生成UUID() {
  const 二十位 = Array.from(new TextEncoder().encode(订阅路径))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 20)
    .padEnd(20, "0");

  const 前八位 = 二十位.slice(0, 8);
  const 后十二位 = 二十位.slice(-12);

  return `${前八位}-0000-4000-8000-${后十二位}`;
}

// 订阅页面
async function 提示界面() {
  // === 新增：显示优选 IP 数量 ===
  const 优选状态 = 优选IP列表.length > 0
    ? `优选IP: ${优选IP列表.length} 个`
    : '未配置优选IP (回退反代)';

  const 提示界面 = `
<title>订阅-${订阅路径}</title>
<style>
  body {
    font-size: 25px;
    text-align: center;
    margin: 0;
    padding: 0;
    height: 100vh;
    width: 100vw;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    overflow: hidden;
  }
</style>
<strong>请把链接导入 ${科拉什} 或 ${威图锐}</strong>
<br><br>
<small>${优选状态}</small>
`;

  return new Response(提示界面, {
    status: 200,
    headers: { "Content-Type": "text/html;charset=utf-8" },
  });
}

function 威图锐配置文件(hostName) {
  let 最终地址 = hostName.endsWith('.pages.dev') ? 默认优选 : hostName;

  const 配置内容 = `${维列斯}://${验证UUID}@${最终地址}:443?encryption=none&security=tls&sni=${hostName}&fp=chrome&type=ws&host=${hostName}#${最终地址}`;

  return new Response(配置内容);
}

function 科拉什配置文件(hostName) {
  let 最终地址 = hostName.endsWith('.pages.dev') ? 默认优选 : hostName;

  const 配置内容 = `
proxies:
- name: ${最终地址}
  type: ${维列斯}
  server: ${最终地址}
  port: 443
  uuid: ${验证UUID}
  udp: true
  tls: true
  sni: ${hostName}
  network: ws
  ws-opts:
    headers:
      Host: ${hostName}
      User-Agent: Chrome

proxy-groups:
- name: 节点列表
  type: select
  proxies:
    - ${最终地址}

rules:
  - GEOSITE,cn,DIRECT
  - GEOIP,CN,DIRECT,no-resolve
  - MATCH,节点列表
`;

  return new Response(配置内容);
}