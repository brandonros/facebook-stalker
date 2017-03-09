require('longjohn');

var Promise = require('bluebird');
var rp = require('request-promise');
var cheerio = require('cheerio');
var sqlite3 = require('sqlite3');
var fs = require('fs');

var selectors = [
  '#root > div.be.bf > div.cc > div:nth-child(2) > div > a',
  '#root > div.be.bf > div.cb > div:nth-child(2) > div > a',
  '#root > div.bf.bg > div.cc > div:nth-child(2) > div > a',
  '#root > div.bf.bg > div.cb > div:nth-child(2) > div > a',
  '#root > div.be.bf > div.ca > div:nth-child(2) > div > a',
  '#root > div.bf.bg > div.ch > div:nth-child(2) > div > a'
];

function getFriends(cookie, friendsUrl, startIndex) {
  var options = {
    method: 'GET',
    uri: 'https://m.facebook.com/' + friendsUrl + '&startindex=' + startIndex,
    headers: {
      'Cookie': cookie,
      'User-agent': 'Googlebot/2.1 (+http://www.googlebot.com/bot.html)'
    }
  };

  console.log(new Date(), options.uri);

  return rp(options);
}

function getProfile(cookie, username) {
  var options = {
    method: 'GET',
    uri: 'https://m.facebook.com/' + username,
    headers: {
      'Cookie': cookie,
      'User-agent': 'Googlebot/2.1 (+http://www.googlebot.com/bot.html)'
    }
  };

  console.log(new Date(), options.uri);

  return rp(options);
}

function extractData(body) {
  var $ = cheerio.load(body);

  var rows = $('div.v.bi');

  var results = [];

  rows.each(function () {
    var row = $(this);

    var img = row.find('img');
    var src = img.attr('src');
    var name = img.attr('alt');

    var link = $(row.find('a')[0]);
    var href = link.attr('href');

    if (!href) { /* andy ding? */
      console.log('Skipping no link ' + name);
      return;
    }

    if (!src || !name) {
      fs.writeFileSync('output.html', body);

      throw new Error('Fucked');
    }

    results.push({
      image: src,
      name: name,
      link: href
    });
  });

  return results;
}

function extractNumFriends(body) {
  var $ = cheerio.load(body);

  var exp = /See All Friends \(([^\)]*)\)/;

  var results;

  for (var i = 0; i < selectors.length; ++i) {
    var text = $(selectors[i]).text();

    results = exp.exec(text);

    if (results) {
      break;
    }
  }

  if (!results) {
    fs.writeFileSync('output.html', body);

    throw new Error('Fucked');
  }

  return results[1];
}

function extractFriendsUrl(body) {
  var $ = cheerio.load(body);

  var friendsUrl = null;

  for (var i = 0; i < selectors.length; ++i) {
    friendsUrl = $(selectors[i]).attr('href');

    if (friendsUrl) {
      break;
    }
  }

  if (!friendsUrl) {
    fs.writeFileSync('output.html', body);

    throw new Error('Fucked');
  }

  return friendsUrl;
}

function crawlUser(cookie, username) {
  return getProfile(cookie, username)
    .then(function (body) {
      var numFriends = extractNumFriends(body);
      var friendsUrl = extractFriendsUrl(body);

      var startIndices = [];

      for (var i = 0; i < numFriends; i += 20) {
        startIndices.push(i);
      }

      return startIndices.reduce(function (prev, startIndex) {
        return prev.then(function (results) {
          return Promise.delay(500)
            .then(function () {
              return getFriends(cookie, friendsUrl, startIndex)
                .then(function (body) {
                  return results.concat(extractData(body));
                });
            });
        });
      }, Promise.resolve([]));
    });
}

function lookupUser(username) {
  return new Promise(function (resolve, reject) {
    db.each('SELECT COUNT(*) AS count FROM relationships WHERE source_profile = ?', username, function (err, row) {
      if (err) {
        return reject(err);
      }

      resolve(row.count);
    });
  });
}

function lookupUserFriends(username) {
  return new Promise(function (resolve, reject) {
    db.all('SELECT link FROM relationships WHERE source_profile = ?', username, function (err, rows) {
      if (err) {
        return reject(err);
      }

      resolve(rows);
    });
  });
}

function initDb() {
  return new Promise(function (resolve, reject) {
    db.run('CREATE TABLE IF NOT EXISTS relationships (source_profile TEXT, name TEXT, image TEXT, link TEXT)', function (err) {
      if (err) {
        return reject(err);
      }

      db.run('CREATE UNIQUE INDEX IF NOT EXISTS relationships_source_profile_link_index ON relationships (source_profile, link)', function (err) {
        if (err) {
          return reject(err);
        }

        resolve();
      });
    });
  });
}

function insertResults(username, results) {
  db.serialize(function () {
    results.forEach(function (result) {
      var statement = db.prepare('INSERT INTO relationships (source_profile, name, image, link) VALUES (?, ?, ?, ?)');

      statement.run(username, result.name, result.image, result.link, function (err) {
        if (err && err.message.indexOf('SQLITE_CONSTRAINT') === -1) {
          throw err;
        }
      });

      statement.finalize();
    });
  });
}

function handleUser(username) {
  return lookupUser(username)
    .then(function (count) {
      if (count === 0) {
        return crawlUser(cookie, username)
          .then(function (results) {
            insertResults(username, results);
          });
      }
    });
}

var username = process.argv[2];;
var cookie = process.argv[3];

var db = new sqlite3.Database('db.sqlite3');

initDb()
.then(function () {
  return handleUser(username);
})
.then(function () {
  return lookupUserFriends(username);
})
.then(function (rows) {
  return Promise.each(rows, function (row) {
    return handleUser(row.link)
      .catch(function (err) {
        console.log(err.stack);
        console.log(row.link);
      });
  });
})
.then(function () {
  db.close();
});