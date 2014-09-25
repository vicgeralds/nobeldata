/* 
 AngularJS service to make SPARQL queries.
 Works with endpoints returning results as JSON.
 Depends on lodash
*/
angular.module('app').factory('sparql', function($http) {

  function toString(array, f) {
    return _.isString(f) ? array.join(f) : f(array);
  }
  // generate SPARQL syntax with f
  // f: array -> string
  function generate(array, f, terminator) {
    if (_.isArray(f)) {
      var funcs = f;
      f = function(array1) {
        var array2 = _.times(funcs.length - 1, function() {
          return array1.shift() || '';
        });
        array2.push(array1);
        generate(array2, function(arrayj, j) {
          return toString(arrayj, funcs[j]);
        });
        return array2.length < funcs.length ? '' :
               array2.join(' ');
      };
    }
    terminator = terminator || '';
    var i;
    for (i = 0; i < array.length; i++) {
      if (_.isArray(array[i]))
        array[i] = f(array[i], i) + terminator;
    }
    _.pull(array, '', terminator);
    return array;
  }
  function propertyList(array) {
    return generate(array, [' ', ' , ']).join(' ; ');
  }
  function indent(lines) {
    var i;
    for (i = 0; i < lines.length; i++) {
      lines[i] = '  ' + lines[i];
    }
    return lines;
  }

  var sparql = {
    // convert prefixes to SPARQL syntax
    // plain object -> string
    prefix: function(prefixes) {
      return _.map(prefixes, function(value, key) {
        return 'PREFIX ' + key + ': <' + value + '>';
      }).join('\n');
    },
    // format select clause
    select: function(vars) {
      if (_.isArray(vars)) {
        vars = _.map(vars, function(name) {
          return _.isArray(name) ?
            '(' + name.join(' AS ?') + ')' :
            '?' + name;
        }).join(' ');
      }
      return 'SELECT ' + vars + ' ';
    },
    // generate graph patterns
    pattern: function() {
      return _.flatten(arguments, function(value) {
        return _.isArray(value) ?
          ['{', indent(generate(value, [' ', propertyList], ' .')), '}'] :
          value;
      });
    },
    // format inline data
    values: function() {
      var lists = _.map(arguments, function(list) {
        return ' (' + (_.isArray(list) ? list.join(' ') : list) + ')';
      });
      lists[0] = 'VALUES' + lists[0] + ' {';
      lists.push('}');
      return lists;
    },
    // send query. returns promise with http response
    query: function(endpoint) {
      var queryString = _.flatten(_.rest(arguments)).join('\n');
      return $http.get(endpoint, {
        params: {
          output: 'json',
          query: queryString
        }
      });
    },
    // get values from results -> { varName1: values1, ... }
    bindings: function(data) {
      var values = _.map(data.head.vars, function(varName) {
        return _.map(data.results.bindings, function(binding) {
          return binding[varName].value;
        });
      });
      return _.zipObject(data.head.vars, values);
    },

    /* Service constructor */
    Service: function(endpoint, prefixes) {
      this.endpoint = endpoint;
      this.prefixes = prefixes;
    }
  };

  /* Service methods */

  // query() using endpoint and prefixes of Service instance
  sparql.Service.prototype.query = function() {
    return sparql.query(this.endpoint, sparql.prefix(this.prefixes),
                        arguments);
  };
  // generate a SELECT query string from arguments and call query()
  sparql.Service.prototype.querySelect = function(vars) {
    return this.query(sparql.select(vars),
                      sparql.pattern.apply(sparql, _.rest(arguments)));
  };

  return sparql;
});
