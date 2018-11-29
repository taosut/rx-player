# ABRManager ###################################################################


## Overview ####################################################################

The ABRManager (ABR for Adaptive BitRate) is a class which facilitates the
choice between multiple audio/video qualities in function of the current
bandwidth, the network capacities and other specific settings set by the client.

It does so by receiving various values such as:
  - when network requests begin, progresses or end
  - stats about the bandwidth of the user
  - the current status of the buffer (how much of the buffer is left etc.)
  - DOM events
  - user settings (maximum authorized bitrate/width etc.)
  - the available qualities

With all those variables in hand, it then proposes the quality which seems to
be the most adapted, that is the quality which:
  - will respect user settings (example: a Maximum bitrate is set)
  - will maximize the user experience (example: a quality too high for the
    network to handle would lead to excessive re-bufferings, but a too low would
    be not as pleasant to watch)


## ABR Algorithm ###############################################################

                 Long
                 (normal mode) [2]  +----------------+
                          +---------+ Buffer Gap [1] +-------+
                          |         +----------------+       |
                   +------v-----+                            |
                   | Request(s) |                            |
                   | datas      |                     Short
                   +-----+------+                     (starvation mode) [4]
                         |
                         |                                   |
    Request time length  |                                   |
    Data size            |                                   |
                         |                                   |
+----------------------+ v +---------------------+   +-------v------+
| Short term EWMA [2a] |   | Long term EWMA [2b] |   | Last request |
+----------------+-----+   +-----+---------------+   +-------+------+
                 |               |                           |
             +---+---------------+---+       +---------------v------------+
             | Ceil bitrate (minimum |       | Ceil bitrate               |
             | between both) [3]     |       | (bandwidth estimation from |
             +-----------+-----------+       | last request [5]           |
                         |                   +--------------------+-------+
                         |                                        |
                    +----v----+       +-----------+        +------v--+
                    | Bitrate <-------+ Available +--------> Bitrate |
                    | ceiling |       | qualities |        | ceiling |
                    +----+----+       +-----------+        +-----+---+
                         |                                       |
                         |         +----------------+            |
                         +---------> Chosen quality <------------+
                                   +----------------+

[1] The buffer gap is the distance between the current time and the buffer time
edge. Our ABR algorithm relies on it.

[2] If the buffer gap is long (more than 5 seconds in our current configuration):
From requests computed bandwidths (data size / request time), calculate two
[EWMA](https://en.wikipedia.org/wiki/EWMA).

[2a] The first, a fast-moving average, falls quickly when estimated bandwidth
falls suddenly.

[2b] The second, a slow-moving average, is a bandwidth mean.

[3] For quality of service, the player should adapt down quickly, to avoid
buffering situations, and grow up slowly, in order to smoothly change quality.
For this reason, the minimum between the two estimated is considered as a
bitrate threshold. The chosen quality is a quality's bitrate ceiling.

[4] If the buffer gap is too short, it is considered as "starving":

[5] An immediate bandwidth is computed from last or current request.
The quality's bitrate ceiling relies on it to return the chose quality.