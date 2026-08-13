module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^socket\\.io-client$': 'smocket',
  },
  testMatch: ['<rootDir>/jest/**/*.test.cjs'],
};
