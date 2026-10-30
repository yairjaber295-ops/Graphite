// Фоновый поток для поиска битов (чтобы интерфейс не подвисал на длинных треках).
import { computeBeats } from './beats.js';

self.onmessage = (e) => {
  const { id, mono, sampleRate } = e.data;
  try {
    self.postMessage({ id, result: computeBeats(mono, sampleRate) });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
