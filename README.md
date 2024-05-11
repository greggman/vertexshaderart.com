# vertexshaderart.com is now a static site

## Saving

To save your work. Bookmark the URL or copy it to your blog/instagram/gist or [this github issue](https://github.com/greggman/vertexshaderart.com/issues/1) etc...

## Music Tracks

Options: 

* `random`

  chooses a random track

* `<some-url-to>.mp3`

  The mp3 file must have the correct permissions to stream. Ideally you'd pick public domain or CC0 track and add it to
  [this repo](https://github.com/greggman/music-lists.git).

* `<some-url.to>.json`

  A json file in the following format

  ```js
  {
    name?: string,    // name of track, if not provided it will be the base name of the url
    author?: string,  // name of author/artist/band
    url?: string,     // url for author's page
    infoUrl?: string, // url for info about the track 
    trackUrl?: string, // url for .mp3 file. if not provided assumes the path
                       // is the same as the .json file just with .mp3 instead
  }
  ```

## License

The site is license MIT but the individual shaders belong to their respective users.