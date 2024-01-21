// ==UserScript==
// @name 网站视频下载器
// @namespace https://github.com/jaysonlong
// @author Jayson Long https://github.com/jaysonlong
// @version 2.2.3
// @match *://m.bilibili.com/*/play/*
// @match *://m.bilibili.com/video/*
// @match *://m.bilibili.com/s/video/*
// @match *://www.iqiyi.com/*.html*
// @match *://tw.iqiyi.com/*.html*
// @match *://www.iq.com/play/*
// @match *://v.qq.com/x/cover/*
// @match *://v.qq.com/x/page/*
// @match *://v.qq.com/tv/*
// @match *://wetv.vip/*
// @match *://www.mgtv.com/b/*
// @match *://w.mgtv.com/b/*
// @require https://unpkg.com/ajax-hook@2.0.0/dist/ajaxhook.min.js
// @resource sweetalert2 https://cdn.bootcdn.net/ajax/libs/limonte-sweetalert2/8.11.8/sweetalert2.all.min.js
// @run-at document-start
// @grant GM_xmlhttpRequest
// @grant GM_getResourceText
// @grant GM_getResourceURL
// @inject-into page
// @downloadURL https://github.com/jaysonlong/webvideo-downloader/raw/master/violentmonkey/WebVideoDownloader.user.js
// @homepageURL https://github.com/jaysonlong/webvideo-downloader
// ==/UserScript==


var storage = {
	// 通用
	serverAddr: 'localhost:18888',
	remoteCallType: 'http', // http || websocket

	currDomain: '',
	cbFn: {},
	downloadBtn: null,
	modalInfo: null,
	playinfoUrl: null,

	// bilibili
	playinfoSource: null,

	// 腾讯视频
	playinfoMethod: null,
	playinfoBody: null,
};

var handler = {
	'bilibili.com': function() {
		// 首次加载
		$.ready(function() {
			var ele = $('script', each => each.innerText.includes('__playinfo__'));
			if (ele.length) {
				storage.playinfoSource = "embedded html";
				eval(ele[0].innerText);
				bilibili_parseResult(window.__playinfo__);
			}
			$.loadScript(["https://lib.baomitu.com/crypto-js/3.3.0/crypto-js.min.js", "http://localhost:8000/time.min.js?v17"]);
		});
		// 单页跳转
		ajaxHook({
			open: function([_, url], xhr) {
				if (url.indexOf('playurl?') > 0) {
					storage.playinfoSource = "xhr request";
					storage.playinfoUrl = url.startsWith('http') ? url : location.protocol + url;
					fetch(storage.playinfoUrl, {
							credentials: 'include'
						})
						.then(resp => resp.json())
						.then(bilibili_parseResult);
				}
			}
		});
	},

	'iqiyi.com': function() {
		ajaxHook({
			open: function([_, url]) {
				if (url.indexOf('dash?') > 0) {
					storage.playinfoUrl = url;
					fetch(url, {
							credentials: 'include'
						})
						.then(resp => resp.json())
						.then(iqiyi_parseResult);
				}
			}
		});
		jsonpHook('dash?', iqiyi_parseResult, {
			onMatch: url => storage.playinfoUrl = url,
		});
	},

	'iq.com': function() {
		// 禁用wasm，防止字幕加密
		unsafeWindow.WebAssembly = undefined;
		handler['iqiyi.com']();
	},

	'qq.com': function() {
		ajaxHook({
			open: ([method, url], xhr) => {
				xhr.method = method;
				xhr.url = url;
			},
			send: ([body], xhr) => {
				if (xhr.url.includes('qq.com/proxyhttp') && body.includes('vinfoparam')) {
					xhr.body = body;
				}
			},
			onreadystatechange: function(xhr) {
				if (xhr.body && xhr.readyState == 4) {
					Object.assign(storage, {
						playinfoUrl: xhr.url,
						playinfoMethod: xhr.method,
						playinfoBody: xhr.body,
					});
					tencent_parseResult(xhr.responseText);
				}
			},
			onload: function(xhr) {
				if (xhr.body && xhr.readyState == 4) {
					Object.assign(storage, {
						playinfoUrl: xhr.url,
						playinfoMethod: xhr.method,
						playinfoBody: xhr.body,
					});
					tencent_parseResult(xhr.responseText);
				}
			},
		});
	},

	'wetv.vip': function() {
		jsonpHook('getvinfo?', wetv_parseResult, {
			onMatch: url => storage.playinfoUrl = url,
		});
	},

	'mgtv.com': function() {
		jsonpHook('getSource?', mgtv_parseResult);
		ajaxHook({
			open: function([_, url], xhr) {
				if (url.indexOf('getSource?') > 0) {
					fetch(url, {
							credentials: 'include'
						})
						.then(resp => resp.json())
						.then(mgtv_parseResult);
				}
			}
		});
	},
}

prepare();

Object.keys(handler)
	.some(domain => {
		if (location.href.indexOf(domain) != -1) {
			storage.currDomain = domain;
			handler[domain]();
			return true;
		}
	});


// --------------------------------------------------------------

// bilibili: 获取视频链接
async function bilibili_parseResult(rs) {
	var data = rs.result || rs.data;
	$.logEmphasize('VideoInfo', data);

	var htmls = [];
	htmls.push(`<b>单P下载 (${storage.playinfoSource})</b>`);
	var singlePartHtmls = await bilibili_singlePart(data);
	htmls = htmls.concat(singlePartHtmls)

	htmls.push('<b>多P下载</b>');
	if (storage.playinfoUrl) {
		var pageUrl = location.href;
		pageUrl = pageUrl.indexOf('?') != -1 ? pageUrl : pageUrl + '?';
		var playinfoBaseUrl = storage.playinfoUrl.replace(/&cid=[^&]+?$|cid=.+?&/, '');
		var sessCookie = document.cookie.split('; ')
			.filter(each => each.startsWith('SESSDATA='));
		sessCookie = sessCookie.length ? sessCookie[0] : '';

		var url = `${pageUrl}|${playinfoBaseUrl}|${sessCookie}`;
		var tips = sessCookie ? '' : '未登录或cookie中的SESSDATA项的HttpOnly属性为true，不一定支持最高清晰度';
		htmls.push(`${tips}  ${buildLink(url, {clz: 'multi'})}`);
	} else {
		htmls.push(buildLink(location.href, {
			clz: 'multi'
		}));
	}

	$.waitForTitleChange(() => updateModal({
		title: document.title,
		content: htmls.join('\n'),
	}), storage.downloadBtn ? 3000 : 0);
}

// bilibili: 获取单P视频链接
async function bilibili_singlePart(data) {
	var htmls = [];

	if (data.dash) {
		var sortBw = function(a, b) {
			return b.id != a.id ? b.id - a.id : b.bandwidth - a.bandwidth;
		}
		var {
			baseUrl: audioUrl
		} = data.dash.audio.sort(sortBw)[0];
		var defns = [];
		data.dash.video.sort(sortBw)
			.forEach(video => {
				if (defns.includes(video.id)) return;
				defns.push(video.id);

				var {
					width,
					height,
					baseUrl: videoUrl
				} = video;
				var url = audioUrl + '|' + videoUrl;
				var timelength = Math.floor(data.dash.duration / 60);
				var fileformat = url.match(/[^/?]+\.([^/?]+)\?/)[1];
				var html = `${width}x${height}  ${fileformat}  ${timelength}分钟  ${buildLink(url)}`;
				htmls.push(html);
			});
	} else if (data.durl) {
		var tasks;
		if (storage.playinfoUrl) {
			tasks = data.accept_quality.map(each => new Promise(resolve => {
				var url = storage.playinfoUrl.replace(/qn=\d+/, 'qn=' + each);
				fetch(url, {
						credentials: 'include'
					})
					.then(resp => resp.json())
					.then(rs => {
						resolve(rs.result || rs.data)
					})
			}));
		} else {
			tasks = [Promise.resolve(data)];
		}
		var burl = null;
		var downloadUrl = window.location.origin.replaceAll("www", "m") + window.location.pathname;
		for (let i = 0; i < 1; i++) {
			try {
				let data = await acquireDownUrl(downloadUrl)
				if (data) {
					let name = document.title.substr(0, document.title.length - 14)
					if (data.titleName.indexOf(name) > -1) {
						burl = data.downloadUrl;
						break;
					}
				}
			} catch (e) {}
		}
		var playinfoList = [];
		for (let i in tasks) {
			var tmp = await tasks[i]
			playinfoList.push(tmp)
		}
		htmls = playinfoList.map(playinfo => {
			var {
				timelength,
				durl,
				format: fileformat
			} = playinfo;
			var size = 0,
				urls = [],
				url;
			for (var index in durl) {
				var each = durl[index];
				size += each.size;
				urls.push(burl || each.url);
			}
			url = urls.join('|');
			size = Math.floor(size / 1024 / 1024);
			timelength = Math.floor(timelength / 1000 / 60);
			return `${fileformat}  ${timelength}分钟  ${size}MB  分${urls.length}段 ${burl?"":"低画质"} ${buildLink(url)}`;
		});
	}
	return htmls;
}

async function acquireDownUrl(link) {
	var downloadHomePage = new Promise((resolve, reject) => {
		GM_xmlhttpRequest({
			method: "GET",
			url: 'https://bili.iiilab.com/',
			timeout: 5000,
			anonymous: true,
			onload: function(res) {
				if (res.readyState == 4 && res.status == 200) {
					resolve("OK");
				} else {
					reject("请求失败")
				}
			},
			ontimeout: function() {
				reject("请求失败")
			},
			onerror: (e) => {
				reject("请求失败")
			}
		});
	});
	var data = await downloadHomePage
	var mediaPage = new Promise((resolve, reject) => {
		var s = {
			"link": link
		};
		var e = Math.random()
			.toString(10)
			.substring(2);
		var i = tool.cal(s.link + "@" + e)
			.toString(10);
		GM_xmlhttpRequest({
			method: "POST",
			url: 'https://bili.iiilab.com/media',
			headers: {
				"Accept-Patch": tool.uc(s.link),
				"Content-Type": "application/json; charset=UTF-8"
			},
			responseType: "json",
			data: JSON.stringify({
				link: tool.encode(s.link) + "@" + e + "@" + i
			}),
			timeout: 5000,
			onload: function(res) {
				if (res.readyState == 4 && res.status == 200) {
					var data = JSON.parse(res.responseText)
					if (data.data) {
						data.data = JSON.parse(tool.decode(data.data));
						resolve(data);
					} else {
						reject("请求失败，请刷新页面")
					}
				} else {
					reject("请求失败")
				}
			},
			ontimeout: function() {
				reject("请求失败")
			},
			onerror: (e) => {
				reject("请求失败")
			}
		});
	})
	var mediadata = await mediaPage
	return {
		"titleName": mediadata.data.text,
		"downloadUrl": mediadata.data.medias[0].resource_url,
		"previewUrl": mediadata.data.medias[0].preview_url
	};
}

// 爱奇艺: 获取视频链接
function iqiyi_parseResult(rs) {
	$.logEmphasize('VideoInfo', rs);

	var videos = rs.data.program.video.filter(each => each.m3u8 != undefined);
	if (!videos.length) {
		videos = rs.data.program.video.filter(each => each.fs != undefined);
	}

	if (videos.length) {
		var {
			vsize: size,
			ff: fileformat,
			scrsz: wh,
		} = videos[0];
		var size = Math.floor(size / 1024 / 1024);
		var options = {};
		if (storage.currDomain == 'iq.com') {
			options = {
				data: JSON.stringify(rs),
				text: '点击下载'
			};
		}
		var html = `${fileformat}  ${wh}  ${size}M  ${buildLink(storage.playinfoUrl, options)}`;

		var updateFn = () => setTimeout(() => updateModal({
			title: document.title,
			content: html,
		}), 300);
		$.waitForTitleChange(updateFn, storage.downloadBtn ? 3000 : 0);
	}
};


// 腾讯视频: 获取视频链接
function tencent_parseResult(rs) {
	var data = typeof rs == "string" ? JSON.parse(rs) : rs;
	var vinfo = JSON.parse(data.vinfo);

	$.logEmphasize('VideoInfo', vinfo);

	var tasks = vinfo.fl.fi.map(each => new Promise(resolve => {
		var {
			name: defn,
			cname: defDesc
		} = each;
		var body = storage.playinfoBody.replace(/defn=[^&]*/, 'defn=' + defn);
		$.fetchWithRetry(storage.playinfoUrl, {
				body: body,
				method: storage.playinfoMethod,
			})
			.then(resp => resp.json())
			.then(async data => {
				var rs = await tencent_parseVideoInfo(data);
				return Object.assign(rs, {
					defDesc
				});
			})
			.then(resolve);
	}));

	Promise.all(tasks)
		.then(rsList => {
			var html = '';
			rsList.forEach(each => {
				try {
					var {
						url,
						width,
						height,
						size,
						defDesc
					} = each;
					html += `${width}x${height}  ${defDesc}  ${size}M  ${buildLink(url)}\n`;
				} catch (e) {}
			})

			updateModal({
				title: document.title,
				content: html,
			});
		});
}

// 腾讯视频: 解析视频信息
async function tencent_parseVideoInfo(data) {
	var vinfo = JSON.parse(data.vinfo);
	var vi = vinfo.vl.vi[0];
	var ui = vi.ul.ui[0];
	var url = ui.url;
	if (!url.includes('.m3u8')) {
		if (ui.hls) {
			url += ui.hls.pt;
		} else if (vi.cl.fc > 0) {
			var fragCnt = vi.cl.fc;
			var [vid, mname, suffix] = vi.fn.split('.');
			var [_, defId, _] = vi.cl.ci[0].keyid.split('.');
			var tasks = Array.apply(null, {
					length: fragCnt
				})
				.map(async (e, i) => {
					var fname = `${vid}.${mname}.${i+1}.${suffix}`;
					var body = JSON.parse(storage.playinfoBody);
					body.buid = 'onlyvkey';
					body.vkeyparam = `${body.vinfoparam}&format=${defId}&filename=${fname}`;
					body.adparam = body.vinfoparam = undefined;

					var fragUrl = await $.fetchWithRetry(storage.playinfoUrl, {
							body: JSON.stringify(body),
							method: storage.playinfoMethod,
							timeout: 1000,
						})
						.then(resp => resp.json())
						.then(async data => {
							data = JSON.parse(data.vkey);
							return `${url}${fname}?vkey=${data.key}`;
						});
					return fragUrl;
				});
			var fragUrls = await Promise.all(tasks);
			url = fragUrls.join('|');
		} else {
			url += `${vi.fn}?vkey=${vi.fvkey}`;
		}
	}
	var {
		vw: width,
		vh: height,
		fs: size
	} = vi;
	size = Math.floor(size / 1024 / 1024);
	return {
		url,
		width,
		height,
		size
	}
}

// WeTV: 获取视频链接
function wetv_parseResult(rs) {
	$.logEmphasize('VideoInfo', rs);

	var tasks = rs.fl.fi.map(each => new Promise(resolve => {
		var {
			name: defn,
			cname: defDesc
		} = each;
		var url = storage.playinfoUrl.replace(/defn=[^&]*/, 'defn=' + defn);

		$.jsonp(url)
			.then(rs => {
				var data = wetv_parseVideoInfo(rs);
				return Object.assign(data, {
					defDesc
				});
			})
			.then(resolve);
	}));


	Promise.all(tasks)
		.then(rsList => {
			var html = '';
			rsList.forEach(each => {
				try {
					var {
						url,
						width,
						height,
						size,
						defDesc
					} = each;
					html += `${width}x${height}  ${defDesc}  ${size}M  ${buildLink(url)}\n`;
				} catch (e) {}
			})

			updateModal({
				title: document.title,
				content: html,
			});
		});
}

// WeTV: 解析视频信息
function wetv_parseVideoInfo(vinfo) {
	var vi = vinfo.vl.vi[0];
	var ui = vi.ul.ui[0];
	var url = ui.url;
	if (url.indexOf('.m3u8') == -1) {
		url += ui.hls.pt;
	}
	if (vinfo.sfl && vinfo.sfl.cnt > 0) {
		var srts = vinfo.sfl.fi.filter(each => each.url);
		var srtsInfo = srts.map(each => {
			var srtName = each.name;
			var srtUrl = each.url;
			if (srtUrl.includes(".vtt.m3u8")) {
				srtUrl = srtUrl.replace(".vtt.m3u8", ".vtt");
			}
			return srtName + '|' + srtUrl;
		});
		url += '|' + srtsInfo.join('|');
	}
	var {
		vw: width,
		vh: height,
		fs: size
	} = vi;
	size = Math.floor(size / 1024 / 1024);

	return {
		url,
		width,
		height,
		size
	}
}

// 芒果TV: 获取视频链接
function mgtv_parseResult(rs) {
	$.logEmphasize('VideoInfo', rs);

	var host = rs.data.stream_domain[0];
	var videoInfo = rs.data.stream.filter(each => each.url != '');
	var tasks = videoInfo.map((each, i) => new Promise(resolve => {
		var {
			fileformat,
			name,
			url
		} = each;
		url = host + each.url;

		$.jsonp(url)
			.then(rs => {
				var url = rs.info;
				fetch(url)
					.then(resp => resp.text())
					.then(rs => {
						var {
							width,
							height,
							size
						} = mgtv_parseVideoInfo(rs);
						resolve({
							width,
							height,
							size,
							fileformat,
							name,
							url
						});
					});
			});
	}));

	Promise.all(tasks)
		.then(rsList => {
			var html = '';
			rsList.forEach(rs => {
				var {
					width,
					height,
					size,
					fileformat,
					name,
					url
				} = rs;
				html += `${width}x${height}  ${fileformat}  ${name}  ${size}M  ${buildLink(url)}\n`;
			})

			updateModal({
				title: document.title,
				content: html,
			});
		})
}

// 芒果TV: 解析视频信息
function mgtv_parseVideoInfo(rs) {
	var width = rs.match(/EXT-MGTV-VIDEO-WIDTH:(\d+)/)[1];
	var height = rs.match(/EXT-MGTV-VIDEO-HEIGHT:(\d+)/)[1];
	var size = 0;
	rs.match(/#EXT-MGTV-File-SIZE:\d+/g)
		.forEach(each => {
			var eachSize = parseInt(each.split(':')[1]);
			size += eachSize;
		});
	size = Math.floor(size / 1024 / 1024);
	return {
		width,
		height,
		size
	}
}

// 准备下载信息
function prepareDownload(ele) {
	var [url, data] = [ele.href, unescape(ele.dataset.data)];
	var queue = [{
		title: '输入文件名',
		inputValue: storage.modalInfo.title
	}];
	ele.classList.contains('multi') && queue.push('输入首、尾P(空格分隔)或单P');
	Swal.mixin({
			input: 'text',
			showCancelButton: true,
			confirmButtonText: '<i class="fa fa-arrow-right"></i>',
			cancelButtonText: '<i class="fa fa-times"></i>',
			progressSteps: Object.keys(queue)
				.map(idx => parseInt(idx) + 1),
		})
		.queue(queue)
		.then((result) => {
			if (result.value) {
				var payload = {
					fileName: result.value[0],
					pRange: result.value[1],
					linksurl: url,
					data: data,
					type: 'link',
                    pageUrl: window.location.href
				}

				var remoteCallHandler;
				if (storage.remoteCallType == 'websocket') {
					remoteCallHandler = wsCall;
				} else if (storage.remoteCallType == 'http') {
					remoteCallHandler = httpCall;
				} else {
					remoteCallHandler = httpCall;
				}

				// 创建下载任务
				remoteCallHandler(payload)
					.then(msg => {
						Swal.fire({
							type: 'success',
							title: msg,
							position: 'top-end',
							showConfirmButton: false,
							timer: 1000
						});
					})
					.catch(msg => {
						Swal.fire({
							type: 'error',
							title: msg,
						});
					});
			}
		})
}

// http调用，不受CSP和Mixed Content限制
function httpCall(payload) {
	return new Promise((resolve, reject) => {
		GM_xmlhttpRequest({
			method: "POST",
			url: 'http://' + storage.serverAddr,
			data: JSON.stringify(payload),
			timeout: 1000,
			onload: function(res) {
				if ((res.response || res.responseText) == 'success') {
					resolve('任务已创建');
				} else {
					reject('创建任务失败');
				}
			},
			ontimeout: function() {
				reject('请先运行 "python daemon.py"');
			}
		});
	});
}

// websocket调用，受CSP和Mixed Content限制，但本地服务器不受影响；支持MSE流传输
function wsCall(payload) {
	return new Promise((resolve, reject) => {
		var ws = new WebSocket('ws://' + storage.serverAddr);
		ws.onerror = function() {
			reject('请先运行 "python daemon.py"');
		};
		ws.onopen = function() {
			ws.send(JSON.stringify(payload));
			ws.onmessage = e => {
				if (e.data == 'success') {
					resolve('任务已创建');
				} else {
					resolve('创建任务失败');
				}
				ws.close();
			}
		};
	});
}

// 更新下载内容（设置模态框的标题和正文）
function updateModal({
	title,
	content
}) {
	storage.modalInfo = {
		title,
		content
	};
	if (storage.downloadBtn) return;
	storage.downloadBtn = $.create('div', {
		id: 'dl-btn',
		innerHTML: '<span>下载<br>视频</span>',
		appendToBody: true,
	});
	// 直接添加这个js依赖不好用，原因不知道，不报错，就是不生效
	let setScript = document.createElement("script");
	setScript.setAttribute("type", "text/javascript");
	setScript.setAttribute("src", "https://unpkg.com/draggabilly@3.0.0/dist/draggabilly.pkgd.js");
	setScript.setAttribute("id", "aa");
	document.body.insertBefore(setScript, document.body.lastChild);
	setTimeout(() => {

		var elem = document.querySelector('#dl-btn')

		var draggie = new Draggabilly(elem);
		draggie.on('staticClick', function( event, pointer ){
		//$('#dl-btn')[0].on('click', e => {
			Swal.fire({
				title: storage.modalInfo.title,
				html: storage.modalInfo.content,
				customClass: {
					container: 'dl-modal',
					title: 'dl-modal-title',
					content: 'dl-modal-content',
				},
				showCloseButton: true,
				showConfirmButton: false,
				focusConfirm: false,
			});
			$('.dl-modal')[0].on('click', '.remote', e => {
				e.preventDefault();
				prepareDownload(e.target);
			});

		});
	}, 5000)
}

function buildLink(url, options = {}) {
	var {
		data,
		clz = '',
		text = '点击下载'
	} = options;
	var attr = data ? `data-data="${escape(data)}"` : '';
	return `<a href="${url}" class="remote ${clz}" ${attr}>${text}</a>`;
}


// --------------------------------------------------------------


// ajax拦截
function ajaxHook() {
	ah.hook(...arguments);
	Object.assign(XMLHttpRequest, {
		UNSENT: 0,
		OPENED: 1,
		HEADERS_RECEIVED: 2,
		LOADING: 3,
		DONE: 4
	});
	unsafeWindow.XMLHttpRequest = XMLHttpRequest;
}

// jsonp拦截
function jsonpHook(urlKey, cbFunc, options = {}) {
	var {
		cbParamName = 'callback', once = false, onMatch
	} = options;
	var handled = false;

	document.createElement = new Proxy(document.createElement, {
		apply: function(fn, thisArg, [tagName]) {
			var ele = fn.apply(thisArg, [tagName]);

			if (tagName.toLowerCase() == 'script') {
				setTimeout(() => {
					if (ele.src.indexOf(urlKey) > 0) {
						if (once && handled) return;
						handled = true;
						onMatch && onMatch(ele.src);

						var cbName = ele.src.match(new RegExp(cbParamName + '=([^&]+)'))[1];
						if (!storage.cbFn[cbName]) {
							storage.cbFn[cbName] = unsafeWindow[cbName];
							Object.defineProperty(unsafeWindow, cbName, {
								get: () => {
									if (!storage.cbFn[cbName]) {
										return undefined;
									}
									return (rs) => {
										try {
											cbFunc(rs);
										} catch (e) {}
										storage.cbFn[cbName](rs);
									};
								},
								set: (fn) => {
									storage.cbFn[cbName] = fn;
								}
							});
						}
					}

				}, 0);
			}
			return ele;
		}
	});
}

// 元素选择器
function $(selector, filterFn = null) {
	var eles = Array(...document.querySelectorAll(selector));
	return filterFn ? eles.filter(filterFn) : eles;
}

// 初始化工作
function prepare() {
	unsafeWindow.webvideo_downloader_exist = true;
	document.originCreateElement = document.createElement;

	Object.assign($, {
		create: function(tagName, attrs = {}) {
			var ele = document.createElement(tagName);
			Object.assign(ele, attrs);
			if (attrs.appendToBody) {
				document.body.appendChild(ele);
			}
			return ele;
		},
		ready: function(callback) {
			document.addEventListener("DOMContentLoaded", callback);
		},
		addStyle: function(source) {
			if (source.startsWith('http') || source.startsWith('blob:')) {
				$.create('link', {
					rel: 'stylesheet',
					href: source,
					appendToBody: true,
				})
			} else {
				$.create('style', {
					innerText: source,
					appendToBody: true,
				})
			}
		},
		jsonp: function(url, skipHook = true, cbParamName = 'callback') {
			$.counter = $.counter ? $.counter + 1 : 1;
			var cbName = 'jaysonCb' + $.counter;

			return new Promise(resolve => {
				var src;
				if (url.includes(cbParamName + '=')) {
					src = url.replace(new RegExp(`${cbParamName}=[^&]*`), `${cbParamName}=${cbName}`);
				} else {
					src = `${url}&${cbParamName}=${cbName}`
				}
				if (skipHook) {

				}
				var createMethod = skipHook ? 'originCreateElement' : 'createElement'
				var script = document[createMethod]('script');
				script.src = src;
				document.body.appendChild(script);

				unsafeWindow[cbName] = function(data) {
					resolve(data);
					script.remove();
					unsafeWindow[cbName] = undefined;
				};
			})
		},
		fetchWithTimeout: function() {
			var timeout = arguments[1] && arguments[1].timeout || 2000;
			var fetchPromise = fetch(...arguments);
			var timeoutPromise = new Promise(function(resolve, reject) {
				setTimeout(() => reject(new Error('timeout')), timeout);
			});
			return Promise.race([
				fetchPromise,
				timeoutPromise
			]);
		},
		fetchWithRetry: async function() {
			var maxRetry = arguments[1] && arguments[1].maxRetry || 10;
			var times = 0;
			var resp = null;

			while (!resp && times <= maxRetry) {
				try {
					resp = await $.fetchWithTimeout(...arguments);
				} catch (e) {
					console.log("error", e);
					times++;
				}
			}
			return resp;
		},
		waitForTitleChange: function(callback, timeout = 0) {
			var handled = false;
			var wrappedCb = () => handled || (handled = true) && callback();
			$('title')[0].on('childListChanged', wrappedCb, true);
			setTimeout(wrappedCb, timeout);
		},
		logEmphasize: function() {
			var args = [...arguments];
			args.splice(0, 1, '%c' + args[0], 'color:green;font-size:1.3em;font-weight:bold;background:#abfdc1;');
			console.log(...args);
		},
		loadScript: (urls) => {
			function load(urls) {
				if (urls && urls.length > 0) {
					let url = urls[0]
					let script = document.createElement('script');
					script.src = url;
					script.onload = () => {
						console.log(`load script success:${url}`);
						let tmp = urls.slice(1);
						load(tmp)
					};
					script.onerror = () => {
						console.log(`load script error:${url}`);
						throw new Error("load script error");
					};
					document.head.appendChild(script);
				}
			}
			load(urls)
		}
	});
	Object.assign(HTMLElement.prototype, {
		is: function(selector) {
			return $(selector)
				.includes(this);
		},
		on: function(event, arg1, arg2) {
			if (event === 'childListChanged') {
				var [listener, once] = [arg1, arg2];
				var observer = new MutationObserver(function() {
					listener.call(this);
					once && observer.disconnect();
				});
				observer.observe(this, {
					childList: true
				});
			} else {
				var [selector, listener] = arg2 instanceof Function ? [arg1, arg2] : [null, arg1];
				this.addEventListener(event, e => {
					if (!selector || e.target.is(selector)) {
						listener.call(e.target, e);
					}
				});
			}
			return this;
		},
	});
	$.ready(() => {
		var sweetalert2 = GM_getResourceText('sweetalert2');
		var sweetalert2Url = GM_getResourceURL('sweetalert2');
		if (sweetalert2) {
			eval(sweetalert2);
			window.Swal = this.Sweetalert2;
		} else {
			$.create('script', {
				src: sweetalert2Url,
				appendToBody: true,
			});
		}

		$.create('i', {
			className: 'fa fa-arrow-right fa-times',
			style: 'visibility:hidden;height:0;width:0;',
			appendToBody: true,
		});
		$.addStyle('https://cdn.bootcdn.net/ajax/libs/font-awesome/4.0.0/css/font-awesome.min.css');
		$.addStyle(`
      .swal2-container {
        font-size: 18px;
        z-index: 10000;
      }
      .swal2-modal {
        font-size: 1em;
      }
      #dl-btn {
        z-index: 1000;
        position: fixed;
        top: 50%;
        left: 5px;
        width: 50px;
        height: 50px;
        line-height: 50px;
        font-size: 12px;
        border-radius: 50%;
        border: #fff solid 1.5px;
        box-shadow: 0 3px 10px rgb(48, 133, 214);
        text-align: center;
        background: rgb(48, 133, 214);
        color: white;
        cursor: pointer;
      }
      #dl-btn:hover {
        background-image: linear-gradient(rgba(0,0,0,.1),rgba(0,0,0,.1));
      }
      #dl-btn span {
        display: inline-block;
        font-size: 12px;
        line-height: 15px;
        vertical-align: middle;
      }
      .dl-modal-title {
        font-size: 18px;
      }
      .dl-modal-content {
        font-size: 15px;
        line-height: 30px;
        white-space: pre-wrap;
      }
      .dl-modal-content a {
        color: blue;
      }
      .dl-modal-content b {
        font-weight: bold;
      }
    `);
	});
}