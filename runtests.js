// Generated by CoffeeScript 1.4.0
(function() {
  var create_client, fs, gen_task, group, http, now, number_of_tests_to_run_in_parallel, parallel, poll, read_json_file, run, run_browsers_in_parallel, run_groups_in_sequence, run_tests_on_browser, sauce_key, saucelabs_key_file, sequence, set_saucelabs_test_data, set_test_status, sleep, test_config, test_config_file, url, wd_sync, webdriver, _, _ref, _set_saucelabs_test_data, _when,
    __slice = [].slice;

  _ = require('underscore');

  fs = require('fs');

  http = require('http');

  webdriver = require('wd');

  wd_sync = require('wd-sync');

  _when = require('when');

  parallel = require('when/parallel');

  sequence = require('when/sequence');

  read_json_file = function(file_path) {
    var contents, json;
    contents = fs.readFileSync(file_path, 'utf-8');
    try {
      json = JSON.parse(contents);
    } catch (e) {
      console.log("unable to parse " + file_path + " as JSON:");
      console.log(e);
      process.exit(1);
    }
    return json;
  };

  test_config_file = process.argv[2];

  if (test_config_file == null) {
    console.log('specify the saucelabs test config JSON file on the command line');
    process.exit(1);
  }

  test_config = read_json_file(test_config_file);

  url = process.argv[3];

  if (url == null) {
    console.log('specify the Meteor tinytest application URL');
    process.exit(1);
  }

  if (fs.existsSync('saucelabs_key.json')) {
    saucelabs_key_file = 'saucelabs_key.json';
  } else if ((process.env.HOME != null) && fs.existsSync(process.env.HOME + '/saucelabs_key.json')) {
    saucelabs_key_file = process.env.HOME + '/saucelabs_key.json';
  } else {
    console.log('need a saucelabs_key.json file');
    process.exit(1);
  }

  sauce_key = read_json_file(saucelabs_key_file);

  _set_saucelabs_test_data = function(config, jobid, data, cb) {
    var body, req;
    body = new Buffer(JSON.stringify(data));
    req = http.request({
      hostname: 'saucelabs.com',
      port: 80,
      path: "/rest/v1/" + config.username + "/jobs/" + jobid,
      method: 'PUT',
      auth: config.username + ':' + config.apikey,
      headers: {
        'Content-length': body.length
      }
    }, (function(res) {
      if (res.statusCode === 200) {
        return cb(null);
      } else {
        return cb('http status code ' + res.statusCode);
      }
    }));
    req.on('error', function(e) {
      return cb(e);
    });
    req.write(body);
    return req.end();
  };

  set_saucelabs_test_data = function(session_id, data) {
    var result;
    result = _when.defer();
    try {
      _set_saucelabs_test_data(sauce_key, session_id, data, function(err) {
        if (err) {
          return result.reject(err);
        } else {
          return result.resolve();
        }
      });
    } catch (e) {
      result.reject(e);
    }
    return result.promise;
  };

  set_test_status = function(session_id, passed) {
    return set_saucelabs_test_data(session_id, {
      passed: passed
    });
  };

  create_client = function() {
    if (test_config.where === 'local') {
      return wd_sync.remote(test_config.selenium_server[0], test_config.selenium_server[1]);
    } else if (test_config.where === 'saucelabs') {
      return wd_sync.remote("ondemand.saucelabs.com", 80, sauce_key.username, sauce_key.apikey);
    } else {
      throw new Error('unknown where in test config: ' + test_config.where);
    }
  };

  sleep = function(ms) {
    var fiber;
    fiber = Fiber.current;
    setTimeout((function() {
      return fiber.run();
    }), ms);
    return Fiber["yield"]();
  };

  now = function() {
    return new Date().getTime();
  };

  poll = function(timeout, interval, testFn, progressFn) {
    var give_up, ok;
    give_up = now() + timeout;
    while (true) {
      ok = testFn();
      if (ok != null) {
        return ok;
      } else if (now() > give_up) {
        return null;
      } else {
        if (typeof progressFn === "function") {
          progressFn();
        }
        sleep(interval);
      }
    }
  };

  run_tests_on_browser = function(run, browser_capabilities) {
    var browser, capabilities, client, done, log;
    done = _when.defer();
    log = function() {
      var args;
      args = 1 <= arguments.length ? __slice.call(arguments, 0) : [];
      return console.log.apply(console, [run].concat(__slice.call(args)));
    };
    client = create_client();
    browser = client.browser;
    browser.on('status', function(info) {
      return log('status', info);
    });
    browser.on('command', function(meth, path) {
      return log('command', meth, path);
    });
    log('launching browser', browser_capabilities);
    capabilities = _.extend(browser_capabilities, {
      'max-duration': 120,
      name: test_config.name
    });
    client.sync(function() {
      var clientlog, data, git_commit, mainWindowHandle, meteor_runtime_config, ok, result, session_id, test_status, userAgent, windowHandles;
      test_status = null;
      session_id = null;
      try {
        session_id = browser.init(capabilities);
        browser.setImplicitWaitTimeout(1000);
        windowHandles = browser.windowHandles();
        if (windowHandles.length !== 1) {
          throw new Error('expected one window open at this point');
        }
        mainWindowHandle = windowHandles[0];
        console.log('mainWindowHandle', mainWindowHandle);
        browser.get(url);
        ok = poll(10000, 1000, (function() {
          return browser.hasElementByCssSelector('.header');
        }), (function() {
          return log('waiting for test-in-browser\'s .header div to appear');
        }));
        if (ok == null) {
          throw new Error('test-in-browser .header div not found');
        }
        userAgent = browser["eval"]('navigator.userAgent');
        log('userAgent:', userAgent);
        meteor_runtime_config = browser["eval"]('window.__meteor_runtime_config__');
        git_commit = meteor_runtime_config != null ? meteor_runtime_config.git_commit : void 0;
        if (git_commit != null) {
          log('git_commit:', git_commit);
        }
        if (test_config.where === 'saucelabs') {
          data = {};
          if (userAgent != null) {
            data['custom-data'] = {
              userAgent: userAgent
            };
          }
          if (git_commit != null) {
            data['build'] = git_commit;
          }
          set_saucelabs_test_data(session_id, data);
        }
        if (test_config.windowtest) {
          browser.elementById('begin-tests-button').click();
        }
        log('tests are running');
        result = poll(20000, 1000, (function() {
          browser.window(mainWindowHandle);
          if (browser.hasElementByCssSelector('.header.pass')) {
            return 'pass';
          } else if (browser.hasElementByCssSelector('.header.fail')) {
            return 'fail';
          } else {
            return null;
          }
        }), (function() {
          return log('waiting for tests to finish');
        }));
        if (result == null) {
          throw new Error('tests did not complete within timeout');
        }
        test_status = result;
      } catch (e) {
        if (e['jsonwire-error'] != null) {
          log(e['jsonwire-error']);
        }
        log('err', e);
        test_status = 'error';
      }
      try {
        browser.window(mainWindowHandle);
        clientlog = browser["eval"]('$("#log").text()');
        log('clientlog', clientlog);
      } catch (e) {
        log('unable to capture client log:');
        if (e['jsonwire-error'] != null) {
          log(e['jsonwire-error']);
        }
        log(e);
      }
      if (test_config.where === 'saucelabs' || test_status) {
        try {
          log(run, 'shutting down the browser');
          browser.quit();
        } catch (e) {
          log(run, 'unable to quit browser', e);
        }
      }
      log(run, 'tests finished:', test_status);
      if (test_config.where === 'saucelabs') {
        log('setting test status at saucelabs', test_status === 'pass');
        set_test_status(session_id, test_status === 'pass').otherwise(function(reason) {
          return console.log(run, 'failed to set test status at saucelabs:', reason);
        });
      }
      if (test_status === 'pass' || test_status === 'fail') {
        return done.resolve();
      } else {
        return done.reject();
      }
    });
    return done.promise;
  };

  group = function(n, array) {
    var g, i, j, result, _i, _j, _ref;
    result = [];
    for (i = _i = 0, _ref = array.length; 0 <= _ref ? _i < _ref : _i > _ref; i = _i += n) {
      g = [];
      for (j = _j = 0; 0 <= n ? _j < n : _j > n; j = 0 <= n ? ++_j : --_j) {
        if (i + j < array.length) {
          g.push(array[i + j]);
        }
      }
      if (g.length > 0) {
        result.push(g);
      }
    }
    return result;
  };

  run = 0;

  gen_task = function(browser_caps) {
    var thisrun;
    ++run;
    thisrun = run + ':';
    return function() {
      return run_tests_on_browser(thisrun, browser_caps);
    };
  };

  run_browsers_in_parallel = function(group) {
    var tasks;
    tasks = _.map(group, gen_task);
    return function() {
      return parallel(tasks);
    };
  };

  run_groups_in_sequence = function(groups) {
    var tasks;
    tasks = _.map(groups, run_browsers_in_parallel);
    return sequence(tasks);
  };

  number_of_tests_to_run_in_parallel = (_ref = test_config.parallelTests) != null ? _ref : 1;

  run_groups_in_sequence(group(number_of_tests_to_run_in_parallel, test_config.browsers));

}).call(this);
