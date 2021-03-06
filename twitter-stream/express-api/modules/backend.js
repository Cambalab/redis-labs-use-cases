var config = require('./../config');
var stringHash = require('string-hash');
var async = require('async');
var Q = require('q');
var indexTweet = require('./../lib').indexTweet;
var getRandom = require('./../lib').getRandom;

// Set up connection to Redis
var redis_conn = require("redis");
var redis = redis_conn.createClient(config.redis.url, {detect_buffers: true, no_ready_check: true});

redis.on("error", function (err) {
  console.log("Error: " + err);
});

// get user id if exists otherwise create user
exports.findUser = function(token) {
  var deferred = Q.defer();

  redis.hget(config.store.auths, token, function(err, reply) {
    if(err) {
     deferred.reject(err);
     return;
    }
    if(reply === null) {
      redis.incr(config.store.user_next_id, function(err, reply) {
        if(err) {
          deferred.reject(err);
          return;
        }
        redis.hset(config.store.auths, token, reply, function(err, reply) {
          if(err) {
            deferred.reject(err);
            return;
          }
          deferred.resolve(reply);
        });

      });
    } else {
      deferred.resolve(reply);
    }
  });

  return deferred.promise;
};

exports.findRecommendations = function(userId, channel) {
  var deferred = Q.defer();
  var tweetHashChannel = config.store.tweetHash + ':' + channel;
  var voteZsetChannel = config.store.voteZset + ':' + channel;
  var rangeArgs = [ voteZsetChannel, 0, 9 ];

  redis.zrevrange(rangeArgs, function (err, response) {
    var result = [];
    if(err) {
      deferred.reject(err);
    } else {
      if (response.length === 0) {
        // No result
        deferred.resolve([]);
      } else {
        async.forEach(response, function (tweetId, callback) {
          redis.hget(tweetHashChannel, tweetId, function (err, reply) {
            // console.log(">>",reply);
            result.push({ id: tweetId, content: reply });
            callback();
          });
        }, function (err) {
          if(err) {
            deferred.reject(err);
            return;
          }
          deferred.resolve(result);
        });
      }
    }
  });

  return deferred.promise;
};

exports.findLikes = function(userId, channel) {
  var deferred = Q.defer();
  var userLikeSet = config.store.likeSet + ':' + userId + ':' + channel;
  var tweetHashChannel = config.store.tweetHash + ':' + channel;

  redis.smembers(userLikeSet, function (err, response) {
    var result = [];
    if(err) {
      deferred.reject(err);
    } else {
      if (response.length === 0) {
        // No result
        deferred.resolve([]);
      } else {
        async.forEach(response, function (tweetId, callback) {
          redis.hget(tweetHashChannel, tweetId, function (err, reply) {
            // console.log(">>",reply);
            result.push({ id: tweetId, content: reply });
            callback();
          });
        }, function (err) {
          if(err) {
            deferred.reject(err);
            return;
          }
          deferred.resolve(result);
        });
      }
    }
  });

  return deferred.promise;
};

exports.findNopes = function(userId, channel) {
  var deferred = Q.defer();
  var userNopeSet = config.store.nopeSet + ':' + userId + ':' + channel;
  var tweetHashChannel = config.store.tweetHash + ':' + channel;

  redis.smembers(userNopeSet, function (err, response) {
    var result = [];
    if(err) {
      deferred.reject(err);
    } else {
      if (response.length === 0) {
        // No result
        deferred.resolve([]);
      } else {
        async.forEach(response, function (tweetId, callback) {
          redis.hget(tweetHashChannel, tweetId, function (err, reply) {
            // console.log(">>",reply);
            result.push({ id: tweetId, content: reply });
            callback();
          });
        }, function (err) {
          if(err) {
            deferred.reject(err);
            return;
          }
          deferred.resolve(result);
        });
      }
    }
  });

  return deferred.promise;
};

exports.voteTweet = function(tweetId, userId, channel, remove) {
  var inc = (remove) ? -1 : 1;
  var voteZsetChannel = config.store.voteZset + ':' + channel;
  var dfd = Q.defer();
  redis.zincrby(voteZsetChannel, inc, tweetId, function (err, reply) {
    if(err) {
      dfd.reject(err);
      return;
    }
    return dfd.resolve(reply);
  });

  return dfd.promise;
};

exports.likeTweet = function(tweetId, userId, channel, remove) {
  var dfd = Q.defer();
  var userLikeSet = config.store.likeSet + ':' + userId + ':' + channel;

  redis.sadd(userLikeSet, tweetId, function (err, reply) {
    if(err) {
      dfd.reject(err);
      return;
    }

    if(remove) {
      exports.removeFromSet(config.store.nopeSet, tweetId, userId, channel)
        .then(function(reply) {
          dfd.resolve(reply);
        })
        .fail(function(err)  {
          dfd.reject(err);
          return;
        });
    } else {
      return dfd.resolve(reply);
    }
  });

  return dfd.promise;
};

exports.nopeTweet = function(tweetId, userId, channel, remove) {
  var dfd = Q.defer();
  var userNopeSet = config.store.nopeSet + ':' + userId + ':' + channel;

  redis.sadd(userNopeSet, tweetId, function (err, reply) {
    if(err) {
      dfd.reject(err);
      return;
    }

    if(remove) {
      exports.removeFromSet(config.store.likeSet, tweetId, userId, channel)
        .then(function(reply) {
          exports.voteTweet(tweetId, userId, channel, true)
            .then(function(reply) {
              dfd.resolve(reply);
            })
            .fail(function(err)  {
              dfd.reject(err);
              return;
            });
        })
        .fail(function(err)  {
          dfd.reject(err);
          return;
        });
    } else {
      return dfd.resolve(reply);
    }

  });

  return dfd.promise;
};

exports.removeFromSet = function(setType, tweetId, userId, channel) {
  var dfd = Q.defer();

  var userTypeSet = setType + ':' + userId + ':' + channel;

  redis.srem(userTypeSet, tweetId, function (err, reply) {
    if(err) {
      dfd.reject(err);
      return;
    }
    return dfd.resolve(reply);
  });

  return dfd.promise;
};


exports.findById = function(tweetId, userId, channel) {
  var res = null;
  var tweetHashChannel = config.store.tweetHash + ':' + channel;
  var dfd = Q.defer();
  redis.hget(tweetHashChannel, tweetId, function (err, reply) {
    if(err) {
      dfd.reject(err);
      return;
    }
    res = (reply) ? { id: tweetId, content: reply } : reply;
    return dfd.resolve(res);
  });

  return dfd.promise;
};


exports.findToSwipe = function(userId, channel) {
  var tweetHashChannel = config.store.tweetHash + ':' + channel;
  var tweetSetChannel = config.store.tweetSet + ':' + channel;
  var likeUserSet = config.store.likeSet + ':' + userId + ':' + channel;
  var nopeUserSet = config.store.nopeSet + ':' + userId + ':' + channel;
  var swipedUserSet = config.store.swipedSet + ':' + userId + ':' + channel;
  var unionArgs =  [ swipedUserSet, likeUserSet, nopeUserSet ];
  var default_offset = 0;
  var default_count = 10;
  var deferred = Q.defer();

  redis.sunionstore(unionArgs, function(err, result) {
    if(err) {
      deferred.reject(err);
      return;
    }
    var diffArgs = [ tweetSetChannel, swipedUserSet ];
    redis.sdiff(diffArgs, function(err, response) {

      var result = [];
      if(err) {
        deferred.reject(err);
      } else {
        if (response.length === 0) {
          deferred.resolve([]);
        } else {
          response = response.slice(default_offset, default_count);
          async.forEach(response, function (tweetId, callback) {
            redis.hget(tweetHashChannel, tweetId, function (err, reply) {
              result.push({ id: tweetId, content: reply});
              callback();
            });
          }, function (err) {
            if(err) {
              deferred.reject(err);
              return;
            }
            deferred.resolve(result);
          });
        }
      }
    });
  });

  return deferred.promise;
};


exports.findViewed = function(userId, offset, count, channel) {
  var default_offset = 0;
  var default_count = 10;
  offset = (offset === undefined) ? default_offset : offset;
  count = (count === undefined) ? default_count : count;

  var tweetHashChannel = config.store.tweetHash + ':' + channel;
  var tweetSetChannel = config.store.tweetSet + ':' + channel;
  var nopeUserSet = config.store.nopeSet + ':' + userId + ':' + channel;
  var diffArgs = [ tweetSetChannel, nopeUserSet ];

  var deferred = Q.defer();

  redis.sdiff(diffArgs, function(err, response) {
    var result = [];
    if(err) {
      deferred.reject(err);
    } else {
      if (response.length === 0) {
        deferred.resolve([]);
      } else {
        response = response.slice(offset, (offset+count));
        async.forEach(response, function (tweetId, callback) {
          redis.hget(tweetHashChannel, tweetId, function (err, reply) {
            result.push({ id: tweetId, content: reply});
            callback();
          });
        }, function (err) {
          if(err) {
            deferred.reject(err);
            return;
          }
          deferred.resolve(result);
        });
      }
    }
  });

  return deferred.promise;
};

exports.findByHashtag = function(hashtag, offset, count, userId, channel) {
  var deferred = Q.defer();
  var score = stringHash(hashtag);
  var default_offset = 0;
  var default_count = 10;

  offset = (offset === undefined) ? default_offset : offset;
  count = (count === undefined) ? default_count : count;

  var tweetHashChannel = config.store.tweetHash + ':' + channel;
  var hashtagZsetChannel = config.store.hashtagZset + ':' + channel;
  var args1 = [ hashtagZsetChannel, score, score, 'LIMIT', offset, count ];

  redis.zrangebyscore(args1, function (err, response) {
    var result = [];
    if(err) {
      deferred.reject(err);
    } else {
      if (response.length === 0) {
        // No result
        deferred.resolve([]);
      } else {
        //console.log('Result', response);
        async.forEach(response, function (tweetId, callback) {
          redis.hget(tweetHashChannel, tweetId, function (err, reply) {
            // console.log(">>",reply);
            result.push({ id: tweetId, content: reply});
            callback();
          });
        }, function (err) {
          if(err) {
            deferred.reject(err);
            return;
          }
          deferred.resolve(result);
        });
      }
    }
  });

  return deferred.promise;
};

exports.findUserChannels= function(userId) {
  var deferred = Q.defer();
  var userChannelSet = config.store.channelSet + ':' + userId ;

  redis.smembers(userChannelSet, function (err, response) {
    var result = [];
    if(err) {
      deferred.reject(err);
      return;
    }
    deferred.resolve(response);
  });

  return deferred.promise;
};

exports.addChannel = function(userId, channel) {
  var dfd = Q.defer();
  var userChannelSet = config.store.channelSet + ':' + userId;

  redis.sadd(userChannelSet, channel, function (err, reply) {
    if(err) {
      dfd.reject(err);
      return;
    }
    redis.publish(config.redis.subscribe_new_channels, channel);
    return dfd.resolve(reply);
  });

  return dfd.promise;
};

exports.removeChannel = function(userId, channel) {
  var dfd = Q.defer();
  var userChannelSet = config.store.channelSet + ':' + userId;

  redis.srem(userChannelSet, channel, function (err, reply) {
    if(err) {
      dfd.reject(err);
      return;
    }
    return dfd.resolve(reply);
  });

  return dfd.promise;
};

exports.addTweet = function(channel, content) {
  var dfd = Q.defer();
  var id_str = getRandom(19);
  var tweet = {
    'id_str': id_str,
    'text': content,
  };
  indexTweet(redis, channel, tweet);
  dfd.resolve(true);
  return dfd.promise;
};

exports.getChannels = function() {
  return config.app.channels;
};
