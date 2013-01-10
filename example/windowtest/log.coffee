return unless Meteor.isClient

Template.log.include = window.location.pathname is '/'
