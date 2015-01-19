angular.module('app', [])

.factory('nobel', function(sparql) {
  var nobel = new sparql.Service('http://data.nobelprize.org/sparql');
  nobel.prefixes = {
    nobel: 'http://data.nobelprize.org/terms/',
    foaf: 'http://xmlns.com/foaf/0.1/',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    owl: 'http://www.w3.org/2002/07/owl#',
    dbpedia: 'http://dbpedia.org/resource/',
    dbpprop: 'http://dbpedia.org/property/',
    'dbpedia-owl': 'http://dbpedia.org/ontology/'
  };

  function prepend(head, tail) {
    tail.unshift(head);
    return tail;
  }
  function renameCountries(countryVar, names) {
    var countryNameVar = countryVar + 'Name';
    var country = countryVar + ' rdfs:label ' + countryNameVar;
    var filter = 'FILTER (' + countryNameVar +
                 ' NOT IN ("' + _.keys(names).join('", "') + '"))';

    var values = sparql.values.apply(sparql, prepend(
      [countryNameVar, '?country'],
      _.map(names, function(name2, name1) {
        return '"' + name1 + '" dbpedia:' + name2;
      })
    ));

    return sparql.pattern(
      [ country + ' ; owl:sameAs ?country',
        filter ],
      'UNION', prepend(country, values)
    );
  }

  nobel.countryOfBirth = [
    '?laureate dbpedia-owl:birthPlace ' +
    '[ a dbpedia-owl:Country ; owl:sameAs|dbpedia-owl:successor ?country ] .'
  ];
  nobel.countryOfAffiliation = prepend(
    '?laureate dbpedia-owl:affiliation/dbpedia-owl:country ?affCountry .',
    renameCountries('?affCountry', {
      'Federal Republic of Germany': 'Germany',
      'Alsace (then Germany, now France)': 'Germany'
    })
  );

  return nobel;
})

/* Get or set the query/search parameters of the URL */
.factory('searchParams', function($location) {
  function split(paramVal) {
    return _.compact((paramVal + '').split(','));
  }
  function toArray(obj) {
    return _.filter(_.keys(obj), function(name) {
      return obj[name];
    });
  }
  function toParamValue(value) {
    if (_.isPlainObject(value)) value = toArray(value);
    if (value && value !== true) value += '';   // convert to string
    return value ? value : null;  // return null to delete falsy properties
  }
  return {
    // extend obj with converted params
    get: function(obj) {
      return _.assign(obj, $location.search(), function(objVal, paramVal) {
        if (_.isArray(objVal)) return _.union(objVal, split(paramVal)).sort();
        if (_.isPlainObject(objVal)) {
          _.forEach(split(paramVal), function(name) {
            objVal[name] = true;
          });
          return objVal;
        }
        return paramVal;
      });
    },
    set: function(obj) {
      $location.search(_.mapValues(obj, toParamValue));
    }
  };
})

/* Controllers */

.controller('CollapseCtrl', function($scope) {
  $scope.toggle = function() {
    $scope.expanded = !$scope.expanded;
  }
})

.controller('QueryFormCtrl', function($scope, searchParams, nobel, sparql) {
  $scope.categories = [];
  $scope.groups = ['laureate', 'gender', 'category', 'country'];

  // get names of prize categories
  nobel.querySelect('?categoryName WHERE',
                    ['?category a nobel:Category ; rdfs:value ?categoryName'])
  .success(function(data) {
    $scope.categories = sparql.bindings(data).categoryName;
  });

  $scope.$on('$locationChangeSuccess', function() {
    // query input fields
    $scope.q = searchParams.get({ category: {} });
  });
  $scope.submitQuery = function() {
    searchParams.set($scope.q);
  };
  $scope.resetQuery = function() {
    $scope.q = {};
  };

  /* Watch checkboxes to automatically change selections */

  function checkAggregate(value) {
    if (value && !$scope.q.aggregate)
      $scope.q.aggregate = 'AVG';
  }
  $scope.$watch('q.shareQuota', checkAggregate);
  $scope.$watch('q.age', checkAggregate);

  $scope.$watch('q.multipleAwards', function(value) {
    if (value && !$scope.q.groupBy)
      $scope.q.groupBy = 'laureate';
  });
})

.controller('QueryResultsCtrl', function($scope, searchParams, nobel) {
  // query results
  $scope.vars = [];
  $scope.bindings = [];

  // build select clause
  function selectVars(q) {
    var vars = ['laureate', 'award'];
    var expressions = {};

    _.forEach(vars, function(varName) {
      expressions[varName] = [ 'COUNT(DISTINCT ?' + varName + ')',
                               varName + 's' ];
    });

    if (q.aggregate && q.aggregate !== 'COUNT') {
      vars = _.filter(['shareQuota', 'age'], function(varName) {
        expressions[varName] = [ q.aggregate + '(?' + varName + ')',
                                 q.aggregate.toLowerCase() + '_' + varName ];
        return q[varName];
      });
      if (q.multipleAwards) vars.push('award');
    }
    if (q.aggregate || q.groupBy) {
      _.pull(vars, q.groupBy);
      if (q.groupBy === 'laureate') {
        vars.unshift('name');
        expressions.name = [ 'MIN(?name)', 'name1' ];
      }
      return _.map(vars, function(varName) {
        return expressions[varName];
      });
    }
    vars.push('awardLabel');
    if (q.countryOfBirth || q.countryOfAffiliation)
      vars.push('country');
    return vars;
  }

  // build where clause
  function wherePattern(q) {
    // properties
    var gender = ['foaf:gender'];
    var category = ['nobel:category/rdfs:value'];
    var share = ['nobel:share'];
    var died = 'dbpprop:dateOfDeath ?died';
    // triple patterns
    var laureate = ['?laureate', 'a nobel:Laureate',
                    'nobel:laureateAward ?award', gender];
    var award = ['?award', category, share];
    var where = [laureate, award];

    if (!q.aggregate && !q.groupBy)
      award.push('rdfs:label ?awardLabel');

    if (q.gender)
      gender.push('"' + q.gender + '"');
    if (q.groupBy === 'gender')
      gender.push('?gender');

    if (q.category.length > 1) {
      category.push('?category');
      where.push('FILTER (?category IN ("' + q.category.join('", "') + '"))');
    } else {
      if (q.category.length)
        category.push('"' + q.category[0] + '"');
      if (q.groupBy === 'category')
        category.push('?category');
    }

    if (q.shared === 'yes') {
      share.push('?share');
      where.push('FILTER (?share != "1")');
    } else if (q.shared === 'no')
      share.push('"1"');

    if (q.stillAlive === 'yes')
      where.push('FILTER NOT EXISTS { ?laureate ' + died + ' }')
    else if (q.stillAlive === 'no')
      laureate.push(died);

    if (q.countryOfBirth)
      where = where.concat(nobel.countryOfBirth);
    if (q.countryOfAffiliation)
      where = where.concat(nobel.countryOfAffiliation);

    if (q.shareQuota) {
      if (!_.contains(share, '?share'))
        share.push('?share');
      where.push('BIND (1/STRDT(?share, xsd:integer) AS ?shareQuota)');
    }
    if (q.age) {
      laureate.push('foaf:birthday ?birthday');
      award.push('nobel:year ?year');
      where.push('BIND (?year - year(?birthday) AS ?age)');
    }

    if (q.groupBy === 'laureate')
      laureate.push('foaf:name ?name');

    return where;
  }

  $scope.$on('$locationChangeSuccess', function() {
    // build query
    var q = searchParams.get({ category: [] });
    var select = selectVars(q);
    var where = wherePattern(q);
    var solutionMod = [];

    if (q.groupBy) {
      select.unshift(q.groupBy);
      solutionMod.push('GROUP BY ?' + q.groupBy);
      if (q.multipleAwards)
        solutionMod.push('HAVING (?awards > 1)');
    }
    if (_.contains(select, 'awardLabel'))
      solutionMod.push('ORDER BY ?awardLabel');
    else if (_.last(select)[1] == 'awards')
      solutionMod.push('ORDER BY DESC(?awards)');

    nobel.querySelect(select, where, solutionMod.join('\n'))
    .success(function(data) {
      $scope.vars = _.without(data.head.vars, 'awardLabel');
      $scope.bindings = data.results.bindings;
      $scope.errorMessage = '';
      $scope.busy = false;
    })
    .error(function(data) {
      $scope.vars = [];
      $scope.bindings = [];
      $scope.errorMessage = data;
      $scope.busy = false;
    });
    $scope.busy = true;
    $scope.query = { queryString: nobel.queryString };
  });
})

/* Filters */

.filter('resourceLabel', function(nobel) {
  return function(binding, varName) {
    var awardLabel = binding.awardLabel &&
                     binding.awardLabel.value.split(', ', 2);
    if (awardLabel) {
      if (varName === 'award') return awardLabel[0];
      if (varName === 'laureate') return awardLabel[1];
    }
    var uri = binding[varName].value;
    var prefix = _.find(nobel.prefixes, function(prefix) {
      return uri.indexOf(prefix) == 0;
    });
    if (prefix) return uri.substring(prefix.length);
    return uri;
  };
});
