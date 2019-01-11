# ABRManager ###################################################################

The ABRManager (ABR for Adaptive BitRate) is a class which facilitates the
choice between multiple audio/video qualities in function of the current
bandwidth, the network capacities and other specific settings set by the client.

## Overview ####################################################################

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

In order to estimate the quality that maximizes the playback experience, the ABR 
relies on two "chooser". The [throughtput chooser](./throughput_chooser.md)
picks a quality from network conditions. The [buffer based chooser](./buffer_based_chooser.md) relies on buffering conditions to make his choices.

As a chooser might be more appropriate for a specific playback condition, we
switch dynamically between choosers to select the final adequate quality :

## Choosers dynamic switch #####################################################

```
      +-----------------------------+------------------------------------------+
      |                             |                                          |
+-----v------+          +-----------v------+                                   |
|  BOLA mode |          | throughput mode  |                                   |
++----------++          +--+------------+--+                                   |
 |          |              |            |                                      |
 |          |              |            |                                      |
 |          |              |            |                                      |
 <- > 5 ------ < 5 ---------- > 10 ------- < 10 -----------+ Buffer gap        |
 |          |              |            |                                      |
 |          |              |            |                                      |
 |          |              |            |             +-----------------------+|
 |          |              |            < ------+-----+                       ||
 |          |   + - - +    |            |       |     | throughput estimation ||
 |          <---| Max |-------------------------------+                       ||
 |          |   + - - +    |            |       |     +-----------------------+|
 |          |      ^       |     +--------------+                              |
 |          |      |       |     |      |                                      |
 |          |      |       |     v      |                                      |
 |          |      |       |  + - - +   |               +-----------------+    |
 |          |      |       <--| Max |-------------------+                 |    |
 |          |      |       |  + - - +   |               | BOLA estimation |    |
 |          |      |       |            |               |                 |    |
 <-----------------+------------------------------------+                 |    |
 |          |              |            |               +-----------------+    |
 |          | BOLA ||      | BOLA ||    |                                      |
 | BOLA     | throughput   | throughtput| throughput                           |
 v----------v--------------v------------v                                      |
 |                                      |                                      |
 |  estimation / new estimation mode    +--------------------------------------+
 |                                      |         BOLA / throughput
 +-----------------+--------------------+
                   |
                   |
                   |
          +- - - - v - - - +      +----------------+
          | quality filter <------+ User  settings |
          +- - - - - - - - +      +----------------+
                   |
                   |
                   v
                quality
```