return unless Meteor.isClient

Meteor.windowtest.numberOfWindowsToOpen 2

Tinytest.addAsync "sample test", (test, onComplete) ->

  test.equal 5, 5
  onComplete()
