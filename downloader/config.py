# -*- coding:utf-8 -*-
import tools
import yaml
import os

args = tools.getArguments({
    'name': '-t:h',
    'metavar': 'N',
    'type': int,
    'default': 8,
    'help': 'the thread count of hls download, default 8',
}, {
    'name': '-t:f',
    'metavar': 'N',
    'type': int,
    'default': 8,
    'help': 'the thread count of fragments download, default 8',
}, {
    'name': '-f',
    'metavar': 'N',
    'type': int,
    'default': 0,
    'help': 'the fragments count of each file, default 0 using the thread count',
}, {
    'name': '-p',
    'metavar': 'PORT',
    'type': int,
    'default': 18888,
    'help': 'the port that the backend server listens on, default 18888',
}, {
    'name': ['-c', '--correct'],
    'action': 'store_true',
    'help': 'correct the timestamp of hls video, merge fragments using binnary mode',
}, {
    'name': '-s',
    'action': 'store_true',
    'help': 'if set, will save the temp files',
}, {
    'name': '-d',
    'action': 'store_true',
    'help': 'debug mode, log more info and save the temp files (ignore -s)',
}, {
    'name': '-i',
    'action': 'store_true',
    'help': 'interactive mode, get url and file name from the command line',
}, {
    'name': '-cf',
    'default': './config.yml',
    'type':str,
    'help': 'config path, read config file content'
})

# hls下载线程数
hlsThreadCnt = getattr(args, 't:h')

# 分段下载线程数
fragThreadCnt = getattr(args, 't:f')

# 分段下载的分段数
fragmentCnt = getattr(args, 'f')

# 守护模式下服务器监听的端口
port = getattr(args, 'p')

# 是否校正hls视频时间戳
correctTimestamp = getattr(args, 'correct')

# 调试模式
debug = getattr(args, 'd')

# 是否保留下载的临时文件，debug模式下忽略该选项
saveTempFile = debug or getattr(args, 's')

# 交互模式
interactive = getattr(args, 'i')

# 临时文件保存路径
tempFilePath = "../temp/"

# 视频文件保存路径
videoFilePath = "../videos/"

# 日志保存路径
logPath = './logs/'

os.makedirs(logPath,exist_ok=True)
os.makedirs(videoFilePath, exist_ok=True)
os.makedirs(tempFilePath, exist_ok=True)

# 配置文件
configPath = getattr(args, 'cf')


def read_config(config_path):
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            data = yaml.load(f, Loader=yaml.FullLoader)
            return data


# 读取配置文件
config = read_config(configPath)
param = config if config else {}
param.setdefault("push",{})
param["push"].setdefault("pushPlus",{})
plus_ = param["push"]["pushPlus"]
plus_.setdefault("sendUrl", "http://www.pushplus.plus/send")
plus_.setdefault("template", "## 下载信息\n"
                                                " - **标题**:{title} \n"
                                                " - **下载结果**:{result} \n"
                                                " - **网页地址**:[点击此打开]({pageUrl}) \n"
                                                " - **完成时间**:{time} \n"
                                                " - **下载耗时**:{consuming} \n"
                                                " - **分辨率**:{resolution} \n"
                                                " - **视频时长**:{duration} \n"
                                                " - **文件大小**:{size}")
plus_['token']=os.getenv("PUSHPLUS_TOEKN") if os.getenv("PUSHPLUS_TOEKN") else plus_['token']