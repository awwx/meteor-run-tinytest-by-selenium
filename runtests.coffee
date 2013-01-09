_         = require 'underscore'
fs        = require 'fs'
http      = require 'http'
webdriver = require 'wd'
wd_sync   = require 'wd-sync'
_when     = require 'when'
parallel  = require 'when/parallel'
sequence  = require 'when/sequence'

read_json_file = (file_path) ->
  contents = fs.readFileSync file_path, 'utf-8'
  try
    json = JSON.parse(contents)
  catch e
    console.log "unable to parse #{file_path} as JSON:"
    console.log e
    process.exit 1
  json

test_config_file = process.argv[2]
unless test_config_file?
  console.log 'specify the saucelabs test config JSON file on the command line'
  process.exit 1
test_config = read_json_file test_config_file

url = process.argv[3]
unless url?
  console.log 'specify the Meteor tinytest application URL'
  process.exit 1

if fs.existsSync('saucelabs_key.json')
  saucelabs_key_file = 'saucelabs_key.json'
else if process.env.HOME? and fs.existsSync(process.env.HOME + '/saucelabs_key.json')
  saucelabs_key_file = process.env.HOME + '/saucelabs_key.json'
else
  console.log 'need a saucelabs_key.json file'
  process.exit 1
sauce_key = read_json_file saucelabs_key_file

_set_test_status = (config, jobid, passed, cb) ->
  body = new Buffer(JSON.stringify({passed: passed}))

  req = http.request(
    {
      hostname: 'saucelabs.com'
      port: 80
      path: "/rest/v1/#{config.username}/jobs/#{jobid}"
      method: 'PUT'
      auth: config.username + ':' + config.apikey
      headers:
        'Content-length': body.length
    },
    ((res) ->
      if res.statusCode is 200
        cb(null)
      else
        cb('http status code ' + res.statusCode)
    )
  )

  req.on 'error', (e) ->
    cb(e)

  req.write(body)
  req.end()

set_test_status = (session_id, passed) ->
  result = _when.defer()
  try
    _set_test_status sauce_key, session_id, passed, (err) ->
      if err
        result.reject(err)
      else
        result.resolve()
  catch e
    result.reject(e)
  result.promise

create_client = ->
  if test_config.where is 'local'
    wd_sync.remote(test_config.selenium_server[0], test_config.selenium_server[1])
  else if test_config.where is 'saucelabs'
    wd_sync.remote(
      "ondemand.saucelabs.com",
      80,
      sauce_key.username,
      sauce_key.apikey
    )
  else
    throw new Error 'unknown where in test config: ' + test_config.where

# Fiber based sleep

sleep = (ms) ->
  fiber = Fiber.current
  setTimeout((-> fiber.run()), ms)
  Fiber.yield()

now = -> new Date().getTime()

poll = (timeout, interval, testFn, progressFn) ->
  give_up = now() + timeout
  loop
    ok = testFn()
    if ok?
      return ok
    else if now() > give_up
      return null
    else
      progressFn?()
      sleep interval

# Run the tests on a single browser selected by `browser_capabilities`,
# which is an object describing which browser / version / operating system
# we want to run the tests on.
#
# See
#  http://code.google.com/p/selenium/wiki/JsonWireProtocol#Capabilities_JSON_Object
# and
#  https://saucelabs.com/docs/browsers (select node.js code)
# for descriptions of what to use in browser_capabilities.
#
# `run_tests_on_browser` returns immediately with a promise while the
# tests run asynchronously.  The promise will be resolved when
# Meteor's test-in-browser finishes running the tests (whether the
# tests themselves pass *or* fail).  The promise will be rejected if
# there is some problem running the test: can't launch the browser,
# can't start the tests, the tests don't finish within the timeout,
# etc.

run_tests_on_browser = (run, browser_capabilities) ->

  done = _when.defer()

  log = (args...) ->
    console.log run, args...

  client = create_client()
  browser = client.browser
  browser.on 'status',  (info)       -> log 'status', info
  browser.on 'command', (meth, path) -> log 'command', meth, path

  log 'launching browser', browser_capabilities

  capabilities = _.extend browser_capabilities,
    'max-duration': 120
    name: test_config.name

  client.sync ->
    test_status = null
    session_id = null
    try
      session_id = browser.init capabilities
      browser.get url

      ok = poll 10000, 1000, (-> browser.hasElementByCssSelector('.header')),
        (-> log 'waiting for test-in-browser\'s .header div to appear')
      throw new Error('test-in-browser .header div not found') unless ok?

      log 'tests are running'

      result = poll 10000, 1000, (->
        if browser.hasElementByCssSelector('.header.pass')
          'pass'
        else if browser.hasElementByCssSelector('.header.fail')
          'fail'
        else
          null
      ), (->
        log 'waiting for tests to finish'
      )

      unless result?
        throw new Error('tests did not complete within timeout')

      test_status = result
    catch e
      log e['jsonwire-error'] if e['jsonwire-error']?
      log 'err', e
      test_status = 'error'
    finally
      # Leave the browser open if running tests locally and the test failed.
      # (No point in leaving it open at saucelabs since it will timeout anyway).
      if test_config.where is 'saucelabs' or test_status
        try
          log run, 'shutting down the browser'
          browser.quit()
        catch e
          log run, 'unable to quit browser', e
    log run, 'tests finished:', test_status
    if test_config.where is 'saucelabs'
      log 'setting test status at saucelabs', test_status is 'pass'
      set_test_status(session_id, test_status is 'pass')
      .otherwise((reason) ->
        console.log run, 'failed to set test status at saucelabs:', reason
      )
    if test_status is 'pass' or test_status is 'fail'
      done.resolve()
    else
      done.reject()

  done.promise


# group(3, [1, 2, 3, 4, 5, 6, 7, 8]) => [[1, 2, 3], [4, 5, 6], [7, 8]]

group = (n, array) ->
  result = []
  for i in [0 ... array.length] by n
    g = []
    for j in [0 ... n]
      g.push array[i + j] if i + j < array.length
    result.push(g) if g.length > 0
  result

run = 0

gen_task = (browser_caps) ->
  ++run
  thisrun = run + ':'
  -> run_tests_on_browser thisrun, browser_caps

run_browsers_in_parallel = (group) ->
  tasks = _.map(group, gen_task)
  -> parallel(tasks)

run_groups_in_sequence = (groups) ->
  tasks = _.map(groups, run_browsers_in_parallel)
  sequence(tasks)

number_of_tests_to_run_in_parallel = test_config.parallelTests ? 1

run_groups_in_sequence(group(number_of_tests_to_run_in_parallel, test_config.browsers))
