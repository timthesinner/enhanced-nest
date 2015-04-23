/**
 * Copyright (c) 2015 TimTheSinner All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
module.exports = function( grunt ) {
  'use strict';

  grunt.loadNpmTasks('grunt-wiredep');

  /**
    Node package info
  */
  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),
    wiredep: {
      app: {
        src: 'index.html'
      }
    }
  });

  /**
    Start the web server on port 8080
  */
  grunt.registerTask('server', 'Start express server', function() {
    require('./server.js').listen(8080, function () {
      grunt.log.writeln('Web server running at http://localhost:8080.');
    }).on('close', this.async());
  });

  /**
    Set the server task as our default.
  */
  grunt.registerTask('default', ['server']);
};