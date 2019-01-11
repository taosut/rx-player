# ABRManager - Buffer based chooser ############################################

```
                              Qualities
                                  +
                                  |
                                  |
+----------------------+   +- - - - - + - - - - - - +
| Appended segment [2] |   | compute BOLA steps [1] |   maintanability score [3]
+--------+-------------+   +- - - - - - - - - - - - +           +
         |                            |                         |
         |                            v                         |
         v                +- - - - - - - - - - - - -+           |
      buffer gap +------> | Compute optimal quality | <---------+
                          +- - - - - - - - - - - - -+
```


[BOLA Algorithm](https://arxiv.org/pdf/1601.06748.pdf) finds optimal quality
value to minimize playback buffering and maximize buffered quality.

[1] BOLA broadly defines minimum buffer steps for which we can allow to download
a quality:

```
                ^
Bitrates (kb/s) |
                |
           3200 |                           +-------------------------+
                |                           |
           1500 |                    +------+
                |                    |
            750 |             +------+
                |             |
            300 |      +------+
                |      |
                +------+------------------------------------------------->
                       5      10     15     20

                                 Buffer gap (s)
```

[2] The BOLA estimation is computed each time a segment is appended (thus buffer
gap is updated).

The RxPlayer has a mecanism that allows to replace buffered segments when newly
estimated quality is upper. That leads to buffer gap not increasing when a chunk
is added. That could mislead BOLA, and cause oscillations between chosen
qualities.

[3] In order to avoid this trend, we compute a maintanability score for currently 
downloaded quality. It is an [EWMA](https://en.wikipedia.org/wiki/EWMA) of the
ratio between segment duration and segment download time. If the score points
that a quality is "maintanable", the BOLA algorithm is "allowed" to pick an
upper quality. Conversely, when a quality may not be downloadable fast enough,
the BOLA is "allowed" to decrease the estimated quality.

If no maintanability score is computed, then BOLA works in a normal way.