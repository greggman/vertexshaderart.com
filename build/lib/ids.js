import crypto from 'node:crypto';
import fs from 'node:fs';

// Meteor's Random.id() alphabet (characters that are hard to mistake for each other)
const UNMISTAKABLE_CHARS = '23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz';
const ID_LENGTH = 17;

function randomString(length, chars) {
  // reject-free: crypto.randomInt is uniform
  let s = '';
  for (let i = 0; i < length; ++i) {
    s += chars[crypto.randomInt(chars.length)];
  }
  return s;
}

/**
 * Makes an id in the same shape as the ids that came out of the old
 * Meteor database, eg 22RaBcCzsbaXEzCh5
 */
export function makeArtId() {
  return randomString(ID_LENGTH, UNMISTAKABLE_CHARS);
}

/**
 * Makes an id in the same shape as the old CollectionFS image ids,
 * eg d2fsmpwp2mvlmqnit
 */
export function makeImageId() {
  return randomString(ID_LENGTH, '0123456789abcdefghijklmnopqrstuvwxyz');
}

/**
 * Like makeArtId but guaranteed not to collide with an existing art folder.
 * @param {string} artDir path to the `art` folder
 */
export function makeUnusedArtId(artDir) {
  for (;;) {
    const id = makeArtId();
    if (!fs.existsSync(`${artDir}/${id}`)) {
      return id;
    }
  }
}
