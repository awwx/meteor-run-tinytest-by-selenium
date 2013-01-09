return unless Meteor.isClient

Tinytest.addAsync "sample test", (test, onComplete) ->

  test.equal 5, 5

  Meteor.setTimeout(
    (->
      test.equal 6, 6, 'six'
      onComplete()
    ),
    200
  )
