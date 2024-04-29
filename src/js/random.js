const RANDOM_RANGE = Math.pow(2, 32);

export class PseudoRandom {
  #randomSeed = 0;

  /**
   * Returns a deterministic pseudo random number between 0 and 1
   * @return {number} a random number between 0 and 1
   */
  random() {
    return (this.#randomSeed =
            (134775813 * this.#randomSeed + 1) %
            RANDOM_RANGE) / RANDOM_RANGE;
  };

  /**
   * Reset the pseudo random number generator (whit optional seed)
   * @param {number} [seed] 
   */
  reset(seed = 0) {
    this.#randomSeed = seed;
  }

  /**
   * Return a random number between 0 and n (but not n)
   * @param {number} [min]
   * @param {number} [max]
   */
  rand(min, max) {
    if (min === undefined) {
      min = 0;
      max = 1;
    } else if (max === undefined) {
      max = min;
      min = 0;
    }
    return min + this.random() * (max - min);
  }

  /**
   * Return a random integer between 0 and n-1
   * @param {number} n
   */
  randInt(min, max) {
    return Math.floor(this.rand(min, max));
  }
}
