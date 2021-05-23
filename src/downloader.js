// const proxy = 'http://localhost:3000'
const proxy = 'https://jiosaavnex.vercel.app'
// functions
const _file = str => str.replace(/\./g, ',').replace(/\//g, "_")
const _url = (url, bit) => url.replace(/https:\/\/.*.com(.*)/, (a, b) => {
	if (bit) return `${proxy}/song${b}`.replace(/(.*)_\d{2,3}.mp4/, bit == 128 ? `$1.mp3` : `$1_${bit}.mp3`)
	else return `${proxy}/image${b}`
})
const _c = str => str[0].toUpperCase() + str.slice(1)
const _json = (R) => JSON.parse(JSON.stringify(R).replace(/&amp/gi, "&").replace(/&copy/gi, "©").replace(/150x150/gi, "500x500").replace(/http:\/\//gi, 'https://').replace(/&#039\;|&quot\;/g, "'"))
const _song = (d, type, i = false) => {
	if (type === 'song') {
		const { id, image, label, year, ...s } = d.songs ? d.songs[0] : d
		const url = s.media_preview_url?.replace(/(.*)preview.saavncdn(.*)_96_p.mp4/, '$1aac.saavncdn$2_96.mp4')
		let array = {
			id, image, label, year, url, type,
			title: _c(s.song),
			album: _c(s.album),
			artists_p: _c(s.primary_artists),
			artists: s.singers,
			language: 'Soundtrack',
			token: s.perma_url?.replace(/.*\/(.*)/, '$1'),
			hd: s["320kbps"] === "true",
			dolby: s["is_dolby_content"],
		}
		if (i) array.track = i
		if (s.disabled && s.disabled == 'true') array.disabled = s.disabled
		if (s.language && s.language !== "unknown") array.language = _c(s.language)
		return array
	} else {
		let songs = []
		d.songs.forEach((s, i) => [...songs, _song(s, 'song', ++i)])
		return ({
			type, songs, image: d.image,
			token: d.perma_url?.replace(/.*\/(.*)/, '$1'),
			id: d.albumid || d.listid,
			title: d.title || d.listname,
		})
	}
}
/**
 * Get Song data
 * @param {HTMLElement} button 
 * @param {'song'|'album'|'playlist'} type 
 * @param {string} token 
 * @param {function|null} callback 
 * @returns Object | null
 */
const getSongsData = (button, type, token, callback = () => { }) => {
	// button.find('i.o-icon--large').removeClass('o-icon-download').addClass('o-icon-download-progress')
	let result = false, data = { type, token }
	// Call to saavn server
	$.ajax({
		url: 'https://www.jiosaavn.com/api.php?__call=webapi.get&ctx=wap6dot0&n=-1&_format=json&_marker=0&api_version=3',
		dataType: "json", data, success: (res) => result = _json(_song(res, type))
	}).always(() => {
		console.log('songs =>', result)
		callback(result)
	})
}
/**
 * Get Array Buffer from url
 * @param {string} url 
 * @param {function | null} onLoad 
 * @param {function | null} onProgress 
 * @param {function | null} onError 
 */
const getURLArrayBuffer = (url, onLoad = () => { }, onProgress = () => { }, onError = () => { }) => {
	const xhr = new XMLHttpRequest()
	xhr.open('GET', url, true)
	xhr.responseType = 'arraybuffer'
	xhr.onprogress = e => {
		const progress = e.loaded / e.total
		onProgress(progress < 1 ? progress : false)
	}
	xhr.onload = () => {
		if (xhr.status === 200) onLoad(xhr.response)
		else { onProgress(false); onError() }
	}
	xhr.onerror = () => onError()
	xhr.send()
}
/**
 * Get Async Downloaded blob of the a Single Song
 * @param {object} song 
 * @param {function | null} onSuccess 
 * @param {function |null} onError 
 * @returns blob
 */
const getSongBlob = async (song, onSuccess = () => { }, onError = () => { }) => {
	if (song.disabled === true) return onError()
	// Get bitrate
	let bitrate = parseInt(localStorage.bitrate),
		bitArray = [16, 32, 64, 128, 192, 320];
	// prepare to download and convert
	const coverUrl = _url(song.image)
	const cover = await (await fetch(coverUrl)).arrayBuffer()
	// Rebuffed if song is unavailable
	const reBuffer = (b = 0) => {
		let bit = bitArray[b], songUrl = _url(song.url, bit)
		// Add tags to downloaded song
		getURLArrayBuffer(songUrl,
			(arrayBuffer) => {
				const writer = new ID3Writer(arrayBuffer)
				const { title, album, artists_p, artists, year, label } = song
				if (song.language) writer.setFrame('TCON', [song.language])
				if (song.track) writer.setFrame('TRCK', song.track)
				writer.setFrame('TIT2', title)
					.setFrame('TPE2', artists_p.split(', '))
					.setFrame('TPE1', artists.split(', '))
					.setFrame('TALB', album)
					.setFrame('TYER', year)
					.setFrame('TPUB', label)
					.setFrame('APIC', { type: 3, data: cover, description: title })
				writer.addTag()
				const blob = writer.getBlob()
				onSuccess(blob)
			},
			(value) => showProgress(song.title, song.id, value),
			() => {
				if (bitrate <= 64 && ++b < bitArray.length) return reBuffer(b)
				else if (--b > 0) return reBuffer(b)
				onError()
			}
		)
	}
	reBuffer(bitArray.indexOf(bitrate))
}
/**
 * Download a Single song with ID3 Meta Data
 * @param {array} song 
 * @param {function | null} onSuccess 
 * @param {function | null} onError 
 */
const downloadWithData = (song, onSuccess = () => { }, onError = () => { }) => {
	getSongBlob(
		song,
		(blob) => {
			saveAs(blob, `${_file(song.title)}.mp3`)
			onSuccess()
		},
		() => onError()
	)
}
/**
 * Download Set of Songs as a Zip
 * @param {array} list 
 * @param {function} onSuccess 
 * @param {function} onError 
 *  
 */
const downloadSongsAsZip = function (list, onSuccess = () => { }, onError = () => { }) {
	const { title, songs, image } = list, n = songs.length
	if (n === 0) return onError()
	// create a zip
	var zip = new JSZip()
	var a = 0, b = 0, err = {}
	// Download cover image for albums
	if (list.type == 'playlist' && image.includes('c.saavncdn.com')) {
		getURLArrayBuffer(_url(image), (image) => zip.file(`_cover_.jpg`, image))
	}
	const count = () => $('#download-bar label').attr({ 'data-a': a, 'data-c': n })
	count()
	// get song blob
	songs.forEach((song, i) => {
		getSongBlob(
			song,
			(blob) => { ++a; count(); zip.file(`${_file(song.title)}.mp3`, blob) },
			() => { ++b; err = { ...err, [`${i + 1}`]: song.title } })
	})
	// Download the zip file
	const download = setInterval(() => {
		$('#download-bar label').attr({ 'data-a': a, 'data-c': n })
		if (a + b !== n) return
		if (b === n) onError(err)
		else if (a !== 0) setTimeout(() => {
			if (b !== 0) toast('Some songs are not downloaded')
			zip.generateAsync({ type: "blob" }).then((blob) => saveAs(blob, _file(title)))
			onSuccess(err)
		}, 1000);
		clearInterval(download)
	}, 500)
	download
}
/**
 * Show Progress
 * @param {string} name 
 * @param {string | number} id 
 * @param {number | boolean} value 
 */
const showProgress = (name, id, value) => {
	const bar = $('#download-bar')
	if (bar.find(`#${id}`).length == 0) {
		const wrapper = $(`<div id="${id}" class="download-wrapper" style="--p:0.15"><div class="wrap"><svg class="progress" viewbox="0 0 24 24"><circle cx="12" cy="12" r="11"/><circle cx="12" cy="12" r="11"/><path d="M1.73,12.91 8.1,19.28 22.79,4.59"/></svg><p class="u-centi u-ellipsis u-color-js-gray-alt-light">${name}</p></div></div>`)
		bar.find('.body-scroll').append(wrapper)
	}
	const progress = $(`#download-bar #${id}`)
	progress.css("--p", value)
	if (value) bar.addClass('active')
	else {
		progress.addClass('done hide')
		setTimeout(() => { progress.remove() }, 3250)
	}
}
