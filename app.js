var Promise = require('bluebird');
var rp = require('request-promise');
var cheerio = require('cheerio');
var fs = require('fs');

function extractData(body) {
  var $ = cheerio.load(body);

  var rows = $('div.by.bz table > tbody > tr');

  var results = [];

  rows.each(function () {
    var row = $(this);

    var img = row.find('img');
    var src = img.attr('src');
    var name = img.attr('alt');

    var link = row.find('a.cb');
    var href = link.attr('href');

    results.push({
      image: src,
      name: name,
      link: 'https://facebook.com/' + href
    });
  });

  return results;
}

function getFriends(cookie, url, startIndex) {
  var options = {
    method: 'GET',
    uri: url + '&startindex=' + startIndex,
    headers: {
      'Cookie': cookie,
      'User-agent': 'Googlebot/2.1 (+http://www.googlebot.com/bot.html)'
    }
  };

  console.log(new Date(), options.uri);

  return rp(options);
}

function getProfile(cookie, url) {
  var options = {
    method: 'GET',
    uri: url,
    headers: {
      'Cookie': cookie,
      'User-agent': 'Googlebot/2.1 (+http://www.googlebot.com/bot.html)'
    }
  };

  console.log(new Date(), options.uri);

  return rp(options);
}

function extractNumFriends(body) {
  var $ = cheerio.load(body);

  var text = $('#root > div.be.bf > div.cc > div:nth-child(2) > div > a').text();

  var exp = /See All Friends \(([^\)]*)\)/;

  var results = exp.exec(text);

  if (!results) {
    return 0;
  }

  return results[1];
}

function extractFriendsUrl(body) {
  var $ = cheerio.load(body);

  return 'https://m.facebook.com' + $('#root > div.be.bf > div.cc > div:nth-child(2) > div > a').attr('href');
}

function crawlUser(cookie, username) {
  return getProfile(cookie, 'https://m.facebook.com/' + username)
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
    })
    .then(function (results) {
      fs.writeFileSync(username + '.json', JSON.stringify(results, undefined, 2));
    });
}

var username = process.argv[2];;
var cookie = process.argv[3];

crawlUser(cookie, username);