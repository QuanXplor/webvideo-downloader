# -*- coding:utf-8 -*-
import os
import time
import traceback
import config
import api
import tools
from tools import WebDownloader
import logging

log = logging.getLogger()


class TaskDispatcher:

    def __init__(self):
        self.saveTempFile = config.saveTempFile
        self.hlsThreadCnt = config.hlsThreadCnt
        self.fragThreadCnt = config.fragThreadCnt
        self.fragmentCnt = config.fragmentCnt
        self.correctTimestamp = config.correctTimestamp
        self.tempFilePath = tools.realPath(config.tempFilePath)
        self.videoFilePath = tools.realPath(config.videoFilePath)

        self.downloader = WebDownloader(self.saveTempFile)
        self.task = None

        tools.mkdirIfNotExists(self.tempFilePath)
        tools.mkdirIfNotExists(self.videoFilePath)
        tools.checkFFmpeg()
        tools.setupRequestLogger(config.logPath)
        tools.setupDebug(config.debug)

    # hls: 下载所有ts分片并合并
    def _downloadHls(self, urls, fileName, headers={}, correct=False):
        print("-- dispatcher/downloadHls")

        tempFileBase = tools.join(self.tempFilePath, fileName)
        fileNames = tools.generateFileNames(urls, tempFileBase)
        targetFileName = tools.join(self.videoFilePath, fileName + '.mp4')

        self.downloader.downloadAll(urls, fileNames, headers, self.hlsThreadCnt)
        tools.mergePartialVideos(fileNames, targetFileName, correct=correct)

        self.saveTempFile or tools.removeFiles(fileNames)
        return targetFileName

    # dash: 下载音频和视频并合并
    def _downloadDash(self, audioUrls, videoUrls, fileName, headers={}):
        print("-- dispatcher/downloadDash")

        tempAudioBase = tools.join(self.tempFilePath, fileName + '.audio')
        tempVideoBase = tools.join(self.tempFilePath, fileName + '.video')
        audioNames = tools.generateFileNames(audioUrls, tempAudioBase)
        videoNames = tools.generateFileNames(videoUrls, tempVideoBase)
        targetFileName = tools.join(self.videoFilePath, fileName + '.mp4')

        self.downloader.multiThreadDownloadAll(audioUrls, audioNames, headers, \
                                               self.fragThreadCnt, self.fragmentCnt)
        self.downloader.multiThreadDownloadAll(videoUrls, videoNames, headers, \
                                               self.fragThreadCnt, self.fragmentCnt)
        tools.mergeAudio2Video(audioNames, videoNames, targetFileName)

        self.saveTempFile or tools.removeFiles(audioNames + videoNames)
        return targetFileName

    # 普通分段视频: 下载并合并
    def _downloadPartialVideos(self, urls, fileName, headers={}):
        print("-- dispatcher/downloadPartialVideos")

        tempFileBase = tools.join(self.tempFilePath, fileName)
        fileNames = tools.generateFileNames(urls, tempFileBase)
        suffix = tools.getSuffix(urls[0])
        targetFileName = tools.join(self.videoFilePath, fileName + suffix)

        for i, url in enumerate(urls):
            self.downloader.multiThreadDownload(url, fileNames[i], headers, \
                                                self.fragThreadCnt, self.fragmentCnt)
        tools.mergePartialVideos(fileNames, targetFileName)

        self.saveTempFile or tools.removeFiles(fileNames)
        return targetFileName

    # websocket视频流，保存至本地并合并
    def handleStream(self, fileName, audioFormat, videoFormat, **desc):
        print("-- dispatcher/handleStream")

        audioName = tools.join(self.tempFilePath, fileName + '.audio' + audioFormat)
        videoName = tools.join(self.tempFilePath, fileName + '.video' + videoFormat)
        targetFileName = tools.join(self.videoFilePath, fileName + '.mp4')

        self.downloader.saveStream(audioName, videoName, **desc)
        tools.mergeAudio2Video([audioName], [videoName], targetFileName)

        self.saveTempFile or tools.removeFiles([audioName, videoName])
        print('Finish %s\n' % targetFileName)
        return targetFileName

    # 下载弹幕并集成到视频文件
    def handleSubtitles(self, subtitles, fileName, videoName, headers={}):
        subtitleUrls, subtitleNames = [], []
        subtitlesInfo = []

        for name, url in subtitles:
            subtitleUrls.append(url)
            subtitleName = tools.join(self.tempFilePath, '%s_%s%s' % \
                                      (fileName, name, tools.getSuffix(url)))
            subtitleNames.append(subtitleName)
            subtitlesInfo.append((name, subtitleName))

        self.downloader.downloadAll(subtitleUrls, subtitleNames, headers, self.hlsThreadCnt)

        for each in subtitleNames:
            tools.tryFixSrtFile(each)

        targetFileName = tools.integrateSubtitles(subtitlesInfo, videoName)
        self.saveTempFile or tools.removeFiles(subtitleNames)
        return targetFileName

    def download(self, url, fileName, data=None):
        fileName = tools.escapeFileName(fileName)
        videoType, headers, audioUrls, videoUrls, subtitles = api.parseSingleUrl(url, data)

        if audioUrls:
            print('匹配到%d段音频，%d段视频，开始下载' % (len(audioUrls), len(videoUrls)))
        else:
            print('匹配到%d段视频，开始下载' % len(videoUrls))

        targetFileName = ''
        if videoType == 'hls':
            # 存在字幕文件时，使用二进制合并以校正时间戳
            correct = self.correctTimestamp or bool(subtitles)
            targetFileName = self._downloadHls(videoUrls, fileName, headers, correct)
        elif videoType == 'dash':
            targetFileName = self._downloadDash(audioUrls, videoUrls, fileName, headers)
        elif videoType == 'partial':
            targetFileName = self._downloadPartialVideos(videoUrls, fileName, headers)

        if subtitles:
            print('匹配到%d个字幕，开始下载' % len(subtitles))
            targetFileName = self.handleSubtitles(subtitles, fileName, targetFileName, headers)

        print('Finish: %s\n' % targetFileName)

        return targetFileName

    def downloadMultiParts(self, url, baseFileName, pRange):
        startP, endP, allPartInfo = api.parseMultiPartUrl(url, pRange)
        result = []
        print('准备下载第%d-%dP\n' % (startP, endP))

        for i in range(startP - 1, endP):
            partName, videoUrl = allPartInfo[i]['name'], allPartInfo[i]['videoUrl']
            fileName = 'P%03d__%s__%s' % (i + 1, baseFileName, partName)
            print('开始下载第%dP: %s' % (i + 1, fileName))
            path = self.download(videoUrl, fileName)
            result.append(path)

        return result

    def pushInfo(self, title, result: bool, pageUrl, savePath, timeConsuming):
        """
        将下载结果发送走
        :param title: 标题
        :param result: 结果是否成功
        :param pageUrl: 页面url
        :param savePath: 保存文件路径
        :param timeConsuming: 耗时
        """
        msg = {
            "title": title,
            "result": "下载完成" if result else "下载失败",
            "pageUrl": pageUrl,
            "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
            "consuming": tools.durationFormat(timeConsuming),
            "size": tools.acquireDiskFileSize(savePath) if result else "",
            "resolution":"",
            "duration":""
        }
        if config.param.get("push").get("pushPlus").get("token"):
            if result:
                video = tools.VideoInfo(savePath)
                msg['resolution'] = video.resolution
                msg['duration'] = video.durationFormat()
            reqData = {
                "token": config.param["push"]["pushPlus"]["token"],
                "title": "下载结果",
                "template": "markdown",
                "content": config.param["push"]["pushPlus"]["template"].format(**msg)
            }
            for i in range(3):
                response = tools.request("POST", config.param["push"]["pushPlus"]["sendUrl"], json=reqData)
                if response.status_code == 200:
                    json = response.json()
                    if json["code"] == 200:
                        msg['pushCode'] = json["data"]
                        break;
                    else:
                        log.error(f"push error: {json}")
        msg['filePath'] = savePath;
        log.info(
            '下载结果:\ntitle:{title} \npageUrl:{pageUrl} \nresult:{result} \nsize:{size} \nfilePath:{filePath}'.format(
                **msg))

    def dispatch(self, **task):
        self.task = task
        task['type'] = task.get('type', 'link')
        print()
        startTime = int(time.time())
        try:
            savePath = None
            if task['type'] == 'link':
                url, fileName = task.get('linksurl') or task['url'], task['fileName']
                data = task.get('data')
                if task.get('pRange'):
                    paths = self.downloadMultiParts(url, fileName, task['pRange'])
                    savePath = paths[0]
                else:
                    savePath = self.download(url, fileName, data)
            elif task['type'] == 'stream':
                savePath = self.handleStream(**task)
            self.pushInfo(task['fileName'], True, task['pageUrl'] if task['pageUrl'] else "", savePath, int(time.time()) - startTime)
        except Exception as e:
            print('-' * 100)
            traceback.print_exc()
            print('-' * 100)
            log.exception(e)
            self.pushInfo(task['fileName'], False, task['pageUrl'] if task['pageUrl'] else "", "", int(time.time()) - startTime)
        except KeyboardInterrupt:
            self.shutdown()
        finally:
            task['type'] == 'stream' and task['close']()
            self.task = None

    def shutdown(self):
        if self.task:
            task = self.task
            self.task = None

            if task['type'] == 'stream':
                task['dataQueue'].put(KeyboardInterrupt())
            self.downloader.shutdownAndClean()
