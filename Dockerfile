FROM ubuntu:23.10 as builder
ENV LINK_X86_64=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
ENV LINK_AMD64=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
ENV LINK_AARCH64=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz
ENV LINK_ARM64=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz
WORKDIR /opt
RUN apt update && apt install -y wget xz-utils && \
wget $(env| grep LINK_`uname -m | tr a-z  A-Z` |cut -d "=" -f 2) && \
tar -xf *.xz &&\
rm -rf *.xz &&\
mv * output && \
chmod +x output/ffmpeg output/ffprobe



FROM python:3.7-slim
COPY downloader /opt/downloader
COPY --from=builder /opt/output/ffmpeg /opt/output/ffprobe /opt/downloader/
WORKDIR /opt/downloader
RUN ln -s `pwd`/ffmpeg /usr/bin && \
ln -s `pwd`/ffprobe /usr/bin && \
pip install -r requirements.txt
EXPOSE 18888
ENTRYPOINT ["python","daemon.py"]