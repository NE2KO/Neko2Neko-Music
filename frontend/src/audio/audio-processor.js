const PROCESSOR_VERSION = 'audio-processor-v1';

function createProcessor() {
  const bandBoundaries = [1, 2, 4, 8, 16, 32, 64, 128];
  const bandCount = bandBoundaries.length - 1;
  const bandEnergies = new Float32Array(bandCount);
  const bandPeaks = new Float32Array(bandCount);
  const bandRMS = new Float32Array(bandCount);
  const smoothedPeaks = new Float32Array(bandCount);
  const transientScores = new Float32Array(bandCount);
  const multiBandEnergy = new Float32Array(bandCount);

  let prevEnergies = new Float32Array(bandCount);
  let sampleCount = 0;
  let globalPeak = 0.001;
  const transientHistory = [];
  const HISTORY_LENGTH = 10;
  const TRANSIENT_THRESHOLD = 1.8;

  function reset() {
    bandEnergies.fill(0);
    bandPeaks.fill(0);
    bandRMS.fill(0);
    smoothedPeaks.fill(0);
    transientScores.fill(0);
    multiBandEnergy.fill(0);
    prevEnergies.fill(0);
    sampleCount = 0;
    globalPeak = 0.001;
    transientHistory.length = 0;
  }

  function detectTransient(currentEnergy) {
    if (sampleCount < HISTORY_LENGTH) return 0;
    const avg = transientHistory.reduce((a, b) => a + b, 0) / transientHistory.length;
    return currentEnergy > avg * TRANSIENT_THRESHOLD ? Math.min(1, (currentEnergy / avg - 1) / 2) : 0;
  }

  function processFrequencyData(frequencyData) {
    const length = frequencyData.length;
    reset();
    sampleCount = 0;

    for (let i = 0; i < length; i++) {
      const value = frequencyData[i] / 255;
      for (let b = 0; b < bandCount; b++) {
        const low = bandBoundaries[b];
        const high = bandBoundaries[b + 1];
        if (i >= low && i < high) {
          bandEnergies[b] += value * value;
          bandRMS[b] += value;
          if (value > bandPeaks[b]) bandPeaks[b] = value;
          multiBandEnergy[b] += value;
        }
      }
      sampleCount++;
    }

    if (sampleCount === 0) return null;

    const result = {
      bandEnergies: new Float32Array(bandCount),
      bandPeaks: new Float32Array(bandCount),
      bandRMS: new Float32Array(bandCount),
      smoothedPeaks: new Float32Array(bandCount),
      transientScores: new Float32Array(bandCount),
      multiBandEnergy: new Float32Array(bandCount),
      globalEnergy: 0,
      version: PROCESSOR_VERSION,
    };

    for (let b = 0; b < bandCount; b++) {
      const rms = Math.sqrt(bandEnergies[b] / sampleCount);
      const energy = multiBandEnergy[b] / sampleCount;
      const peak = bandPeaks[b];
      const smoothed = smoothedPeaks[b] * 0.8 + peak * 0.2;
      const transient = detectTransient(energy, b);

      transientHistory.push(energy);
      if (transientHistory.length > HISTORY_LENGTH) transientHistory.shift();

      result.bandEnergies[b] = energy;
      result.bandPeaks[b] = peak;
      result.bandRMS[b] = rms;
      result.smoothedPeaks[b] = smoothed;
      result.transientScores[b] = transient;
      result.multiBandEnergy[b] = energy;
      result.globalEnergy += energy;

      smoothedPeaks[b] = smoothed;
      prevEnergies[b] = energy;
    }

    if (result.globalEnergy > globalPeak) {
      globalPeak = result.globalEnergy;
    }

    return result;
  }

  return {
    version: PROCESSOR_VERSION,
    ready: true,
    reset,
    processFrequencyData,
    getGlobalPeak: () => globalPeak,
  };
}

let processor = null;
function getProcessor() {
  if (!processor) processor = createProcessor();
  return processor;
}
function resetProcessor() {
  if (processor) processor.reset();
  processor = null;
}

export { getProcessor, resetProcessor, PROCESSOR_VERSION };
