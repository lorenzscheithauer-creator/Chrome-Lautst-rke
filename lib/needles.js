// --- START: Code originally from needles-worker.js ---

class Counter {
  constructor (targetCount, callback = function () {}, context = null) {
    this.targetCount = targetCount;
    this.callback = callback;
    this.context = context;
    this.count = 0;
  }
  increment (count) {
    this.count += count;
    if (this.count >= this.targetCount) {
      this.callback.call(this.context);
      this.count = this.count % this.targetCount;
    }
  }
  willMeetTarget (count) { return this.count + count >= this.targetCount }
  reset () { this.count = 0; }
}

class Bin {
  constructor (length) {
    this.length = length;
    this.array = new Float32Array(length);
    this.count = 0;
  }
  add (items) {
    const remainingCount = this.length - this.count;
    const itemsToAdd = items.slice(0, remainingCount);
    this.array.set(itemsToAdd, this.count);
    this.count += itemsToAdd.length;
  }
  get full () { return this.length === this.count }
}

class Block {
  constructor (options) {
    this.channelCount = options.channelCount;
    this.length = options.length;
    this.count = 0;
    this.full = false;
  }
  get bins () {
    if (this._bins) return this._bins
    this._bins = Array(this.channelCount).fill(null).map(() => this.createBin());
    return this._bins
  }
  add (channels) {
    this.bins.forEach((bin, i) => bin.add(channels[i]));
    this.full = (this.count += channels[0].length) > this.length;
  }
  dump () { return this.bins.map(bin => bin.array) }
  createBin () { return new Bin(this.length) }
}

function sum (numbers) {
  var sum = 0;
  for (var i = numbers.length - 1; i >= 0; i--) { sum += numbers[i]; }
  return sum
}

function meanSquare (samples) {
  var sum = 0;
  for (var i = samples.length - 1; i >= 0; i--) { sum += Math.pow(samples[i], 2); }
  return sum / samples.length
}

function cumulativeMovingAverage ({ value, index, mean }) {
  return (value + (index * (mean || 0))) / (index + 1)
}

const GAINS = [1, 1, 1, 1.41, 1.41];

class LoudnessMeasurement {
  constructor (channels = []) {
    this.powers = channels.map(samples => meanSquare(samples));
  }
  weightedPowers (powers) {
    return (powers || this.powers).map((power, index) => power * GAINS[index])
  }
  loudness (powers) {
    return -0.691 + 10 * Math.log10(sum(this.weightedPowers(powers)))
  }
}

class MomentaryLoudnessMeter {
  constructor (options) {
    this.name = options.name;
    this.delegate = options.delegate;
    this.sampleRate = options.sampleRate;
    this.blockDuration = options.blockDuration;
    this.blockMargin = options.blockMargin;
    this.updateDuration = options.updateDuration;
    this.blocks = [];
    this.fullBlocks = [];
  }
  get blockLengthInSamples () { return Math.round((this.blockDuration / 1000) * this.sampleRate) }
  get blockMarginLengthInSamples () { return Math.round((this.blockMargin / 1000) * this.sampleRate) }
  get updateLengthInSamples () { return Math.round((this.updateDuration / 1000) * this.sampleRate) }
  get blockMarginCounter () {
    return (this._blockMarginCounter = this._blockMarginCounter || new Counter(this.blockMarginLengthInSamples))
  }
  get updateCounter () {
    return (this._updateCounter = this._updateCounter || new Counter(this.updateLengthInSamples, this.update, this))
  }
  input (input) {
    this.channelCount = input.length;
    const sampleCount = input[0].length;
    if (!this.blocks.length || this.blockMarginCounter.willMeetTarget(sampleCount)) {
      this.blocks.push(this.createBlock());
    }
    this.blocks = this.blocks.filter((block) => {
      block.add(input);
      if (block.full) {
        this.fullBlocks.push(block);
        return false
      }
      return true
    });
    this.updateCounter.increment(sampleCount);
    this.blockMarginCounter.increment(sampleCount);
  }
  createBlock () { return new Block({ channelCount: this.channelCount, length: this.blockLengthInSamples }) }
  update () {
    const block = this.fullBlocks[0] ? this.fullBlocks.shift() : this.blocks[0];
    this.delegate.update(this.name, new LoudnessMeasurement(block.dump()).loudness());
  }
  reset () {
    this.blocks = [];
    this.fullBlocks = [];
    this.blockMarginCounter.reset();
    this.updateCounter.reset();
    this.delegate.update(this.name, new LoudnessMeasurement(this.createBlock().dump()).loudness());
  }
}

const ABSOLUTE_THRESHOLD = -70;

class IntegratedLoudnessMeter extends MomentaryLoudnessMeter {
    // ... [Implementation of IntegratedLoudnessMeter, which is not used but kept for completeness]
}

class Processor {
  constructor (delegate) {
    this.delegate = delegate;
    this.recording = false;
  }
  message (event) {
    switch (event.data.type) {
    case 'initialize':
      for (var key in event.data.attributes) { this[key] = event.data.attributes[key]; }
      break
    case 'record': this.recording = true; this.delegate.trigger('start'); break
    case 'pause': this.recording = false; this.delegate.trigger('pause'); break
    case 'resume': this.recording = true; this.delegate.trigger('resume'); break
    case 'stop': this.reset(); this.recording = false; this.delegate.trigger('stop'); break
    case 'reset': this.reset(); break
    case 'process': this.process(event.data.input); break
    }
  }
  process (input) {
    if (!this.recording) return
    this.meters.forEach(meter => meter.input(input));
    return true
  }
  get meters () {
    if (this._meters) return this._meters
    const map = { 'momentary': this._createMomentaryMeter };
    this._meters = this.modes.map(mode => map[mode].call(this));
    return this._meters
  }
  update (mode, value) {
    this.delegate.trigger('dataavailable', { type: 'dataavailable', mode: mode, value: value });
  }
  reset () { this.meters.forEach(meter => meter.reset()); }
  _createMomentaryMeter () {
    return new MomentaryLoudnessMeter({
      name: 'momentary', delegate: this, sampleRate: this.sampleRate,
      blockDuration: 400, blockMargin: 100, updateDuration: 100
    })
  }
}

// --- END: Code from needles-worker.js ---


// --- START: Code originally from needles.js, now refactored ---

function preFilterCoefficients (fs) {
  const db = 3.999843853973347, f0 = 1681.974450955533, Q = 0.7071752369554196;
  const K = Math.tan(Math.PI * f0 / fs), Vh = Math.pow(10, db / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  const d0 = 1 + K / Q + K * K;
  return {
    numerators: [(Vh + Vb * K / Q + K * K) / d0, 2 * (K * K - Vh) / d0, (Vh - Vb * K / Q + K * K) / d0],
    denominators: [1, 2 * (K * K - 1) / d0, (1 - K / Q + K * K) / d0]
  }
}

function weightingFilterCoefficients (fs) {
  const f0 = 38.13547087602444, Q = 0.5003270373238773, K = Math.tan(Math.PI * f0 / fs);
  const d1 = 2 * (K * K - 1) / (1 + K / Q + K * K), d2 = (1 - K / Q + K * K) / (1 + K / Q + K * K);
  return { numerators: [1, -2, 1], denominators: [1, d1, d2] }
}

function preFilter (audioContext) {
  const c = preFilterCoefficients(audioContext.sampleRate);
  return audioContext.createIIRFilter(c.numerators, c.denominators);
}

function weightingFilter(audioContext) {
  const c = weightingFilterCoefficients(audioContext.sampleRate);
  return audioContext.createIIRFilter(c.numerators, c.denominators);
}

var events = {
  on: function (type, listener) { (this._listeners[type] = this._listeners[type] || []).push(listener); },
  off: function (type, listener) {
    if (!type) { this._listeners = {}; return }
    if (listener) { this._listeners[type] = (this._listeners[type] || []).filter(l => l !== listener); }
    else { delete this._listeners[type]; }
  },
  trigger: function (type, data) {
    (this._listeners[type] || []).forEach((listener) => { listener({ type: type, data: data }); });
  }
};

class InvalidStateError extends Error {
  constructor (message) { super(message); this.name = 'InvalidStateError'; }
}

// --- Refactored Controller (No Worker) ---
class Controller {
  constructor (options) {
    this.state = 'inactive';
    this._listeners = {};
    Object.assign(this, events);

    this.source = options.source;
    this.context = this.source.context;

    // Directly instantiate the Processor
    this.processor = new Processor(this);
    this.processor.message({
      type: 'initialize',
      attributes: {
        sampleRate: this.context.sampleRate,
        modes: options.modes
      },
    });

    // Setup ScriptProcessorNode for audio processing
    const node = (this.context.createScriptProcessor || this.context.createJavaScriptNode)
        .call(this.context, 1024, this.source.channelCount, this.source.channelCount);

    node.onaudioprocess = (event) => {
      const channels = [];
      for (var i = 0; i < this.source.channelCount; i++) {
        channels[i] = event.inputBuffer.getChannelData(i);
      }
      this.processor.message({ type: 'process', input: channels });
    };

    // Connect the graph
    this.source.connect(node);

    // This connection is necessary for onaudioprocess to fire.
    // To prevent double audio, we connect it to a muted gain node.
    const muteNode = this.context.createGain();
    muteNode.gain.value = 0;
    node.connect(muteNode);
    muteNode.connect(this.context.destination);
  }

  start () {
    if (this.state !== 'inactive') throw new InvalidStateError(`Failed to execute 'start' on 'Needles': The Needles's state is '${this.state}'.`);
    this.state = 'recording';
    this.processor.message({ type: 'record' });
  }

  stop () {
    if (this.state === 'inactive') throw new InvalidStateError(`Failed to execute 'stop' on 'Needles': The Needles's state is '${this.state}'.`);
    this.state = 'inactive';
    this.processor.message({ type: 'stop' });
  }
  // Other control methods (pause, resume, reset) can be added here if needed
}

// --- Main Export ---
function LoudnessMeter (options) {
  options.modes = options.modes || ['momentary'];
  const context = options.source.context;
  const filter1 = preFilter(context);
  const filter2 = weightingFilter(context);
  options.source.connect(filter1);
  filter1.connect(filter2);

  // The 'weightedSource' is the output of the filtering stage.
  // This is what will be processed.
  return new Controller({ ...options, source: filter2 })
}

export { LoudnessMeter };