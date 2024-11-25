export default class WebAudio {
    constructor(url) {
        this.url = url;

        this.connected = false;

        // Constants for audio behavior
        this.maximumAudioLag = 0.25; // Amount of seconds we can potentially be behind the server audio stream
        this.syncLagInterval = 500; // Check every x milliseconds if we are behind the server audio stream
        this.updateBufferEvery = 20; // Add received data to the player buffer every x milliseconds
        this.reduceBufferInterval = 20; // Trim the output audio stream buffer every x milliseconds so we don't overflow
        this.maximumSecondsOfBuffering = 0.2; // Maximum amount of data to store in the play buffer
        this.connectionCheckInterval = 100; // Check the connection every x milliseconds

        // Register all our background timers. These need to be created only once - and will run independent of the object's streams/properties
        setInterval(() => this.updateQueue(), this.updateBufferEvery);
        setInterval(() => this.syncInterval(), this.syncLagInterval);
        setInterval(() => this.reduceBuffer(), this.reduceBufferInterval);
        setInterval(() => this.tryLastPacket(), this.connectionCheckInterval);
    }

    // Registers all the event handlers for when this stream is closed - or when data arrives.
    registerHandlers() {
        this.mediaSource.addEventListener('sourceended', e => this.socketDisconnected(e));
        this.mediaSource.addEventListener('sourceclose', e => this.socketDisconnected(e));
        this.mediaSource.addEventListener('error', e => this.socketDisconnected(e));
        this.buffer.addEventListener('error', e => this.socketDisconnected(e));
        this.buffer.addEventListener('abort', e => this.socketDisconnected(e));
    }

    // Starts the web audio stream. Only call this method on button click.
    start() {
        if (!!this.connected) return;
        if (!!this.audio) this.audio.remove();
        this.queue = null;

        this.mediaSource = new MediaSource();
        this.mediaSource.addEventListener('sourceopen', e => this.onSourceOpen());
        // First we need a media source - and an audio object that contains it.
        this.audio = document.createElement('audio');
        this.audio.src = window.URL.createObjectURL(this.mediaSource);

        // Start our stream - we can only do this on user input
        this.audio.play();
    }

    wsConnect() {
        if (!!this.socket) this.socket.close();

        this.socket = new WebSocket(this.url, ['binary', 'base64']);
        this.socket.binaryType = 'arraybuffer';
        this.socket.addEventListener('message', e => this.websocketDataArrived(e), false);
    }

    // This is called when the media source contains data
    onSourceOpen(e) {
        if (this.mediaSource.readyState === 'open') {
            this.buffer = this.mediaSource.addSourceBuffer('audio/webm; codecs="opus"');
            this.registerHandlers();
            this.wsConnect();
        } else {
            console.error('MediaSource is not ready to open.');
        }
    }

    // Whenever data arrives in our websocket this is called.
    websocketDataArrived(e) {
        this.lastPacket = Date.now();
        this.connected = true;
        this.queue = this.queue == null ? e.data : this.concat(this.queue, e.data);
    }

    // Whenever a disconnect happens this is called.
    socketDisconnected(e) {
        console.log(e);
        this.connected = false;
    }

    tryLastPacket() {
        if (this.lastPacket == null) return;
        if ((Date.now() - this.lastPacket) > 1000) {
            this.socketDisconnected('timeout');
        }
    }

    // This updates the buffer with the data from our queue
    updateQueue() {
        if (!(!!this.queue && !!this.buffer && !this.buffer.updating)) {
            return;
        }

        this.buffer.appendBuffer(this.queue);
        this.queue = null;
    }

    // Reduces the stream buffer to the minimal size that we need for streaming
    reduceBuffer() {
        if (!(this.buffer && !this.buffer.updating && !!this.audio && !!this.audio.currentTime && this.audio.currentTime > 1)) {
            return;
        }

        this.buffer.remove(0, this.audio.currentTime - 1);
    }

    // Synchronizes the current time of the stream with the server
    syncInterval() {
        if (!(this.audio && this.audio.currentTime && this.audio.currentTime > 1 && this.buffer && this.buffer.buffered && this.buffer.buffered.length > 1)) {
            return;
        }

        var currentTime = this.audio.currentTime;
        var targetTime = this.buffer.buffered.end(this.buffer.buffered.length - 1);

        if (targetTime > (currentTime + this.maximumAudioLag)) this.audio.currentTime = targetTime;
    }

    // Joins two data arrays - helper function
    concat(buffer1, buffer2) {
        var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
        tmp.set(new Uint8Array(buffer1), 0);
        tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
        return tmp.buffer;
    }
}
