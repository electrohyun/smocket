module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^socket\\.io-client$': process.env.SMOCKET_CLIENT_TARGET || 'smocket',
  },
  testMatch: ['<rootDir>/jest/**/*.test.cjs'],
};
